import { BACKEND } from "@/lib/platform";
import type { Diagnostics } from "@/lib/market/diagnostics";
import type { SymbolHit } from "@/lib/market/search";
import type { SyncRequest, SyncResult } from "@/lib/market/sync";
import type { InsightRequestInput } from "@/lib/insights/digest";
import type { GeneratedReport } from "@/lib/insights/generate";
import type { ParsedEntry, ParseRequest } from "@/lib/insights/parse-entry";

/**
 * De donde salen los datos, segun donde este corriendo la app.
 *
 * En la web la app le pega a sus propias rutas /api y el servidor hace el
 * trabajo con la clave del deploy. En el APK no hay servidor: el mismo codigo
 * corre en el telefono, los proveedores se consultan por el puente nativo y la
 * clave de Anthropic es la que cargo el usuario en Ajustes.
 *
 * Toda la pantalla habla con este modulo y no sabe cual de los dos es.
 */

export interface BackendContext {
  /** Clave de acceso a /api, si el deploy la exige. Solo modo servidor. */
  accessKey?: string;
  /** Clave de Anthropic del usuario. Solo modo telefono. */
  apiKey?: string;
}

export class BackendError extends Error {
  constructor(
    message: string,
    readonly code: string = "error",
  ) {
    super(message);
    this.name = "BackendError";
  }
}

export const ON_DEVICE = BACKEND === "device";

function headersFor(ctx: BackendContext): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ctx.accessKey) headers["x-waltra-key"] = ctx.accessKey;
  return headers;
}

async function post<T>(path: string, body: unknown, ctx: BackendContext): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: headersFor(ctx),
    body: JSON.stringify(body),
  });
  // Un 504 casi siempre es el limite de tiempo del hosting, no un problema del
  // modelo. Es un achaque del modo servidor: en el telefono el pedido va
  // directo a Anthropic y no hay proxy que lo corte.
  if (res.status === 504 || res.status === 408) {
    throw new BackendError("El servidor cortó la conexión.", "gateway_timeout");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new BackendError(data.error ?? `HTTP ${res.status}`, data.code ?? "http_error");
  return data as T;
}

/** La clave del usuario, o un error que la pantalla sabe explicar. */
function requireKey(ctx: BackendContext): string {
  const key = ctx.apiKey?.trim();
  if (!key) {
    throw new BackendError(
      "Falta tu clave de Anthropic. Cargala en Ajustes para habilitar esto.",
      "no_api_key",
    );
  }
  return key;
}

/**
 * En el telefono el SDK se carga solo cuando hace falta. Pesa bastante y la
 * enorme mayoria de las aperturas de la app no lo tocan nunca.
 */
async function client(ctx: BackendContext) {
  const key = requireKey(ctx);
  const { anthropicFor } = await import("@/lib/insights/generate");
  return anthropicFor(key, true);
}

async function wrap<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof BackendError) throw err;
    const code = (err as { code?: string })?.code;
    throw new BackendError(err instanceof Error ? err.message : String(err), code ?? "error");
  }
}

export async function syncMarket(req: SyncRequest, ctx: BackendContext): Promise<SyncResult> {
  if (!ON_DEVICE) return post<SyncResult>("/api/market", req, ctx);
  return wrap(async () => {
    const { SyncRequestSchema, syncMarket: run } = await import("@/lib/market/sync");
    return run(SyncRequestSchema.parse(req));
  });
}

export async function diagnostics(light: boolean, ctx: BackendContext): Promise<Diagnostics> {
  if (!ON_DEVICE) {
    const res = await fetch(`/api/health${light ? "?light=1" : ""}`, { headers: headersFor(ctx) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new BackendError(data.error ?? `HTTP ${res.status}`, data.code ?? "http_error");
    return data as Diagnostics;
  }
  return wrap(async () => {
    const { MOCK_ENABLED, probeProviders } = await import("@/lib/market/diagnostics");
    const { resolveModel } = await import("@/lib/insights/models");
    const base = {
      mock: MOCK_ENABLED,
      aiConfigured: Boolean(ctx.apiKey?.trim()),
      model: resolveModel(undefined),
    };
    if (light) return { ...base, providers: [], at: new Date().toISOString() };
    const { providers, totalMs } = await probeProviders();
    return { ...base, providers, totalMs, at: new Date().toISOString() };
  });
}

export async function parseEntry(req: ParseRequest, ctx: BackendContext): Promise<ParsedEntry> {
  if (!ON_DEVICE) return post<ParsedEntry>("/api/parse", req, ctx);
  return wrap(async () => {
    const { parseEntry: run } = await import("@/lib/insights/parse-entry");
    return run(await client(ctx), req);
  });
}

export async function insights(
  req: InsightRequestInput,
  ctx: BackendContext,
): Promise<GeneratedReport> {
  if (!ON_DEVICE) return post<GeneratedReport>("/api/insights", req, ctx);
  return wrap(async () => {
    // El esquema completa lo que la pantalla no mando, igual que hace la ruta
    // /api cuando el trabajo corre en el servidor.
    const { InsightRequestSchema } = await import("@/lib/insights/digest");
    const { generateReport } = await import("@/lib/insights/generate");
    return generateReport(await client(ctx), InsightRequestSchema.parse(req));
  });
}

/**
 * Buscar un activo por nombre.
 *
 * Es el unico camino de la app que traduce "nike" a "NKE". El catalogo local
 * sigue resolviendo al instante lo que ya conoce; esto entra cuando no lo
 * conoce, que es la mayoria de las veces.
 */
export async function searchSymbols(q: string, ctx: BackendContext): Promise<SymbolHit[]> {
  if (!ON_DEVICE) {
    const { hits } = await post<{ hits: SymbolHit[] }>("/api/search", { q }, ctx);
    return hits ?? [];
  }
  return wrap(async () => {
    const { searchSymbols: run } = await import("@/lib/market/search");
    return run(q);
  });
}

/**
 * Como se le explica al usuario que algo fallo.
 *
 * La falta de clave se cuenta distinto segun donde este: en el APK la carga el
 * en Ajustes, en la web la define quien despliega. El resto de los errores van
 * tal cual vienen: que la app invente una explicacion no ayuda a nadie.
 */
export function describeBackendError(err: unknown): string {
  if (err instanceof BackendError && err.code === "no_api_key") {
    return ON_DEVICE
      ? "Falta tu clave de Anthropic. Cargala en Ajustes para usar esto."
      : "Para esto hace falta configurar una clave de Anthropic en el servidor.";
  }
  if (err instanceof BackendError && err.code === "gateway_timeout") {
    return (
      "El servidor cortó la conexión antes de que terminara el análisis. " +
      "Suele pasar en planes con límite de 60 segundos: probá con un modelo " +
      "más rápido desde Ajustes, o corré la app en tu red."
    );
  }
  return err instanceof Error ? err.message : String(err);
}
