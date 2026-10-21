/**
 * El cliente de la API de Binance, solo lectura.
 *
 * Firma cada pedido con la clave secreta del usuario (HMAC-SHA256, lo que
 * Binance llama SIGNED) y lo manda por el transporte que corresponde: en el
 * telefono sale directo por el puente nativo; en la web pasa por la ruta
 * /api/binance, porque Binance no deja que un navegador mande su cabecera de
 * clave. La clave secreta nunca sale de donde se firma.
 *
 * Nada de lo que hay aca opera: no hay un solo pedido que no sea GET.
 */

export const BINANCE_API = "https://api.binance.com";

export interface BinanceResponse {
  status: number;
  /** Cabeceras en minusculas. Solo importan las de limite de pedidos. */
  headers: Record<string, string>;
  body: unknown;
}

/** Como sale un pedido: el puente nativo, la ruta /api/binance o un falso en los tests. */
export type BinanceTransport = (req: { url: string; apiKey?: string }) => Promise<BinanceResponse>;

export type BinanceErrorKind =
  /** La clave no existe, se borro o no tiene permiso de lectura. */
  | "auth"
  /** Binance pidio esperar. `retryAfter` dice cuanto, en segundos. */
  | "rate"
  /** No hubo respuesta: sin señal, o Binance caido. */
  | "network"
  /** Cualquier otra cosa que conteste Binance. */
  | "api";

export class BinanceError extends Error {
  constructor(
    message: string,
    readonly kind: BinanceErrorKind,
    readonly retryAfter?: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = "BinanceError";
  }
}

/**
 * Lo usado del limite de este minuto, segun las cabeceras de Binance. Son tres
 * cuentas separadas: la de /api por IP, la de /sapi por IP y la de /sapi por
 * cuenta. El historial de retiros, por ejemplo, gasta 18.000 de la ultima.
 */
export interface Usage {
  ip: number;
  sapiIp: number;
  uid: number;
}

/** Los codigos con los que Binance dice que la clave no sirve. */
const AUTH_CODES = new Set([-2008, -2014, -2015, -1022]);

/** Margen de reloj: un telefono con la hora corrida unos segundos igual entra. */
const RECV_WINDOW = 10_000;

export async function hmacHex(secret: string, message: string): Promise<string> {
  // Sin https (la web servida por http en la red local) el navegador no
  // ofrece criptografia: mejor decirlo que fallar con un TypeError.
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new BinanceError("Para conectar Binance hace falta abrir la app por https.", "api");
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Params = Record<string, string | number | boolean | undefined>;

function query(params: Params): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.append(k, String(v));
  }
  return qs.toString();
}

function messageOf(body: unknown): { code?: number; msg?: string } {
  if (body && typeof body === "object") {
    const b = body as { code?: unknown; msg?: unknown; message?: unknown };
    const code = typeof b.code === "number" ? b.code : undefined;
    const msg = typeof b.msg === "string" ? b.msg : typeof b.message === "string" ? b.message : undefined;
    return { code, msg };
  }
  return typeof body === "string" ? { msg: body.slice(0, 200) } : {};
}

export class BinanceClient {
  /** Diferencia entre el reloj de Binance y el del telefono, en ms. */
  private offset = 0;
  usage: Usage = { ip: 0, sapiIp: 0, uid: 0 };

  constructor(
    private readonly creds: { apiKey: string; secret: string },
    /** Publico solo para que `sync.ts` guarde por transporte lo que no cambia (la lista de pares). */
    readonly transport: BinanceTransport,
    private readonly now: () => number = Date.now,
  ) {}

  /** Un pedido publico: cotizaciones y velas, sin clave. */
  async public<T>(path: string, params: Params = {}): Promise<T> {
    const qs = query(params);
    return (await this.send(`${BINANCE_API}${path}${qs ? `?${qs}` : ""}`, false)) as T;
  }

  /** Un pedido con datos de la cuenta: va firmado. */
  async signed<T>(path: string, params: Params = {}): Promise<T> {
    try {
      return (await this.sendSigned(path, params)) as T;
    } catch (err) {
      // -1021: el reloj del telefono esta corrido. Se pregunta la hora a
      // Binance una vez y se reintenta; no vale la pena insistir mas.
      if (err instanceof BinanceError && err.code === -1021) {
        const { serverTime } = await this.public<{ serverTime: number }>("/api/v3/time");
        this.offset = serverTime - this.now();
        return (await this.sendSigned(path, params)) as T;
      }
      throw err;
    }
  }

  private async sendSigned(path: string, params: Params): Promise<unknown> {
    const qs = query({ ...params, recvWindow: RECV_WINDOW, timestamp: Math.round(this.now() + this.offset) });
    const signature = await hmacHex(this.creds.secret, qs);
    return this.send(`${BINANCE_API}${path}?${qs}&signature=${signature}`, true);
  }

  private async send(url: string, withKey: boolean): Promise<unknown> {
    let res: BinanceResponse;
    try {
      res = await this.transport({ url, apiKey: withKey ? this.creds.apiKey : undefined });
    } catch (err) {
      throw new BinanceError(err instanceof Error ? err.message : String(err), "network");
    }
    this.track(res.headers);

    if (res.status === 429 || res.status === 418) {
      const retry = Number(res.headers["retry-after"]);
      throw new BinanceError(
        "Binance pidió esperar antes de seguir preguntando.",
        "rate",
        Number.isFinite(retry) && retry > 0 ? retry : 60,
      );
    }
    const { code, msg } = messageOf(res.body);
    if (res.status === 401 || (code !== undefined && AUTH_CODES.has(code))) {
      throw new BinanceError(msg ?? "Binance no aceptó la clave.", "auth", undefined, code);
    }
    if (res.status >= 500) throw new BinanceError(msg ?? `Binance devolvió ${res.status}.`, "network", undefined, code);
    if (res.status >= 400 || (code !== undefined && code < 0)) {
      throw new BinanceError(msg ?? `Binance devolvió ${res.status}.`, "api", undefined, code);
    }
    return res.body;
  }

  private track(headers: Record<string, string>) {
    const n = (k: string) => Number(headers[k]);
    if (Number.isFinite(n("x-mbx-used-weight-1m"))) this.usage.ip = n("x-mbx-used-weight-1m");
    if (Number.isFinite(n("x-sapi-used-ip-weight-1m"))) this.usage.sapiIp = n("x-sapi-used-ip-weight-1m");
    if (Number.isFinite(n("x-sapi-used-uid-weight-1m"))) this.usage.uid = n("x-sapi-used-uid-weight-1m");
  }
}
