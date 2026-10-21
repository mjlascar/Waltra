import { NATIVE } from "@/lib/platform";
import type { BinanceResponse, BinanceTransport } from "./client";

/**
 * Por donde salen los pedidos a Binance.
 *
 * En el telefono, directo y por el puente nativo, que no tiene CORS. En la
 * web no se puede: Binance contesta las consultas publicas a cualquier
 * navegador, pero rechaza la previa que hace falta para mandar la cabecera
 * con la clave. Ahi el pedido, ya firmado, pasa por /api/binance, que solo lo
 * reenvia. La clave secreta no sale nunca de donde se firma.
 */
export function binanceTransport(ctx: { accessKey?: string } = {}): BinanceTransport {
  return NATIVE ? viaNative : viaServer(ctx);
}

function lower(headers: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
}

const viaNative: BinanceTransport = async ({ url, apiKey }) => {
  const { CapacitorHttp } = await import("@capacitor/core");
  const res = await CapacitorHttp.request({
    url,
    method: "GET",
    headers: { Accept: "application/json", ...(apiKey ? { "X-MBX-APIKEY": apiKey } : {}) },
    connectTimeout: 15_000,
    readTimeout: 20_000,
  });
  let body: unknown = res.data;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      // Un error de Binance a veces llega como texto: se deja tal cual.
    }
  }
  return { status: res.status, headers: lower(res.headers), body };
};

function viaServer(ctx: { accessKey?: string }): BinanceTransport {
  return async ({ url, apiKey }) => {
    const res = await fetch("/api/binance", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(ctx.accessKey ? { "x-waltra-key": ctx.accessKey } : {}) },
      body: JSON.stringify({ url, apiKey }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as BinanceResponse;
  };
}
