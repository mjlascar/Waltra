import { NATIVE } from "@/lib/platform";

/**
 * El unico lugar por el que sale un pedido HTTP a un proveedor de precios.
 *
 * Existe porque el APK y la web no pueden usar el mismo transporte. En la web
 * los pedidos salen del servidor de Next, que no tiene CORS que respetar. En
 * el telefono no hay servidor: el pedido sale del WebView, y Yahoo, data912 y
 * dolarapi no mandan cabeceras de CORS, asi que un `fetch` comun se lo come el
 * navegador. `CapacitorHttp` resuelve eso haciendo el pedido desde codigo
 * nativo, donde el CORS ni existe.
 *
 * La eleccion es una constante de compilacion, no una deteccion en vivo: no
 * hay ventana en la que el primer refresco salga por el transporte equivocado.
 */

const UA =
  "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36";

export interface JsonInit {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

function baseHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    // Varios de estos endpoints publicos rechazan pedidos sin user-agent.
    "User-Agent": UA,
    Accept: "application/json,text/plain,*/*",
    ...extra,
  };
}

async function viaFetch<T>(url: string, init: JsonInit): Promise<T> {
  const timeoutMs = init.timeoutMs ?? 12_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: baseHeaders(init.headers),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    // "This operation was aborted" no le dice nada a nadie.
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`no respondió en ${Math.round(timeoutMs / 1000)} s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function viaNative<T>(url: string, init: JsonInit): Promise<T> {
  // La importacion es perezosa para que el bundle web nunca arrastre el
  // plugin: con NATIVE en falso este camino no se alcanza jamas.
  const { CapacitorHttp } = await import("@capacitor/core");
  const timeoutMs = init.timeoutMs ?? 12_000;
  const res = await CapacitorHttp.request({
    url,
    method: "GET",
    headers: baseHeaders(init.headers),
    connectTimeout: timeoutMs,
    readTimeout: timeoutMs,
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
  // El puente nativo ya parsea cuando el content-type dice json; data912 y
  // algun otro contestan text/plain y llegan como cadena.
  if (typeof res.data === "string") {
    try {
      return JSON.parse(res.data) as T;
    } catch {
      throw new Error("la respuesta no era JSON");
    }
  }
  return res.data as T;
}

/** Envoltorio de fetch con timeout y errores legibles. */
export function getJson<T>(url: string, init: JsonInit = {}): Promise<T> {
  return NATIVE ? viaNative<T>(url, init) : viaFetch<T>(url, init);
}
