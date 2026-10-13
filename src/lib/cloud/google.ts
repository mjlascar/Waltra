import { z } from "zod";
import { NATIVE } from "@/lib/platform";

export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const SCOPES = ["openid", "email", "profile", DRIVE_SCOPE];

export class GoogleError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

/** Google acepta CORS tambien desde el origen https://localhost del APK. */
export async function googleRequest(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const target = new URL(url);
  if (target.protocol !== "https:" || !["www.googleapis.com", "openidconnect.googleapis.com"].includes(target.hostname) || target.username || target.password || target.port) {
    throw new Error("Destino de Google no permitido.");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers, credentials: "omit", cache: "no-store",
    redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    const message = res.status === 401 ? "La sesión de Google venció. Volvé a conectar tu cuenta." :
      res.status === 403 ? "Google rechazó el acceso. Revisá el permiso de Drive y la configuración de la app." :
      res.status === 429 ? "Google recibió demasiados pedidos. Probá de nuevo en unos minutos." :
      `Google Drive no pudo completar el pedido (HTTP ${res.status}).`;
    throw new GoogleError(message, res.status);
  }
  return res;
}

/** Limita bytes de red antes de construir el texto o parsear JSON. */
export async function readGoogleText(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Google devolvió una respuesta vacía.");
  const tooLarge = () => new Error("La respuesta de Google supera el límite permitido. No se modificaron tus datos.");
  if (Number(response.headers.get("Content-Length")) > limit) {
    await reader.cancel(); throw tooLarge();
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw tooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

const userSchema = z.object({ sub: z.string().min(1), email: z.string().email(), name: z.string().optional() });
export type GoogleUser = z.infer<typeof userSchema>;
export interface GoogleSession { user: GoogleUser; token: string; expiresAt: number }

async function session(token: string, expiresIn = 3600): Promise<GoogleSession> {
  const res = await googleRequest(token, "https://openidconnect.googleapis.com/v1/userinfo");
  return { user: userSchema.parse(JSON.parse(await readGoogleText(res, 16 * 1024))), token, expiresAt: Date.now() + expiresIn * 1000 };
}

interface TokenResponse { access_token?: string; expires_in?: number; scope?: string; error?: string }
interface GoogleIdentity {
  accounts: { oauth2: {
    initTokenClient(config: {
      client_id: string; scope: string; include_granted_scopes: boolean;
      callback: (response: TokenResponse) => void;
      error_callback: (error: { type: string }) => void;
    }): { requestAccessToken(options: { prompt: string }): void };
  } };
}
declare global { interface Window { google?: GoogleIdentity } }

let preparation: Promise<void> | undefined;
export function prepareGoogle(): Promise<void> {
  if (!GOOGLE_CLIENT_ID) return Promise.reject(new Error("Falta configurar el cliente de Google."));
  preparation ??= (async () => {
    if (NATIVE) {
      const { SocialLogin } = await import("@capgo/capacitor-social-login");
      await SocialLogin.initialize({ google: { webClientId: GOOGLE_CLIENT_ID, mode: "online" } });
      return;
    }
    if (window.google?.accounts.oauth2) return;
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      const timeout = window.setTimeout(() => {
        script.remove(); reject(new Error("Google no respondió. Revisá tu conexión y volvé a intentar."));
      }, 15_000);
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => { clearTimeout(timeout); resolve(); };
      script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error("No se pudo cargar el acceso a Google.")); };
      document.head.append(script);
    });
  })().catch((err: unknown) => { preparation = undefined; throw err; });
  return preparation;
}

export async function loginGoogle(): Promise<GoogleSession> {
  await prepareGoogle();
  if (NATIVE) {
    const { SocialLogin } = await import("@capgo/capacitor-social-login");
    const { result } = await SocialLogin.login({ provider: "google", options: { scopes: SCOPES } });
    if (result.responseType !== "online" || !result.accessToken?.token) {
      throw new Error("Google no otorgó acceso a Drive. Volvé a conectar y aceptá el permiso.");
    }
    return session(result.accessToken.token);
  }
  const identity = window.google;
  if (!identity) throw new Error("No se pudo cargar el acceso a Google.");
  const token = await new Promise<TokenResponse>((resolve, reject) => {
    const client = identity.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID, scope: SCOPES.join(" "), include_granted_scopes: false,
      callback: (response) => {
        if (response.error || !response.access_token) reject(new Error("No se autorizó el acceso a Google."));
        else if (!response.scope?.split(" ").includes(DRIVE_SCOPE)) reject(new Error("Para sincronizar, aceptá el permiso para los datos de Waltra en Drive."));
        else resolve(response);
      },
      error_callback: (error) => reject(new Error(error.type === "popup_closed" ?
        "Se canceló el acceso a Google." : "No se pudo abrir Google. Permití las ventanas emergentes y reintentá.")),
    });
    client.requestAccessToken({ prompt: "select_account" });
  });
  return session(token.access_token!, Number(token.expires_in) || 3600);
}

/** Solo Android restaura la sesion desde el SDK. En web el token queda en memoria. */
export async function restoreGoogle(): Promise<GoogleSession | null> {
  if (!NATIVE || !GOOGLE_CLIENT_ID) return null;
  await prepareGoogle();
  const { SocialLogin } = await import("@capgo/capacitor-social-login");
  if (!(await SocialLogin.isLoggedIn({ provider: "google" })).isLoggedIn) return null;
  const result = await SocialLogin.getAuthorizationCode({ provider: "google" });
  return result.accessToken ? session(result.accessToken) : null;
}

export async function logoutGoogle(): Promise<void> {
  if (NATIVE) {
    const { SocialLogin } = await import("@capgo/capacitor-social-login");
    await SocialLogin.logout({ provider: "google" });
  }
}
