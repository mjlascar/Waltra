import { NextResponse } from "next/server";
import { checkAccess } from "@/lib/api-auth";
import { BINANCE_API } from "@/lib/binance/client";
import { MOCK_ENABLED } from "@/lib/market/mock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Solo consultas de cuenta y de mercado: nada que opere. */
const RUTAS = ["/api/v3/", "/sapi/v1/"];
/** Lo unico de la respuesta que le importa al cliente, ademas del cuerpo. */
const CABECERAS = ["retry-after", "x-mbx-used-weight-1m", "x-sapi-used-ip-weight-1m", "x-sapi-used-uid-weight-1m"];

/**
 * Reenvia a Binance un pedido ya firmado en el navegador.
 *
 * Existe porque Binance no deja que un navegador le mande la cabecera con la
 * clave. La firma se hace del lado del usuario, asi que por aca pasan la
 * clave publica y el pedido firmado, nunca la secreta. Solo GET, solo a
 * api.binance.com y solo a las rutas de lectura.
 */
export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as { url?: unknown; apiKey?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url : "";
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey : undefined;
  let destino: URL;
  try {
    destino = new URL(url);
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }
  if (destino.origin !== BINANCE_API || !RUTAS.some((r) => destino.pathname.startsWith(r))) {
    return NextResponse.json({ error: "Solo se reenvían consultas a la API de Binance." }, { status: 400 });
  }

  if (MOCK_ENABLED) {
    const { mockBinance } = await import("@/lib/binance/fake");
    return NextResponse.json(await mockBinance()({ url, apiKey }));
  }

  try {
    const res = await fetch(destino, {
      headers: apiKey ? { "X-MBX-APIKEY": apiKey } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      // Se devuelve el texto: la app lo muestra como el error que es.
    }
    const headers: Record<string, string> = {};
    for (const h of CABECERAS) {
      const v = res.headers.get(h);
      if (v !== null) headers[h] = v;
    }
    return NextResponse.json({ status: res.status, headers, body: data });
  } catch {
    return NextResponse.json({ error: "Binance no respondió." }, { status: 502 });
  }
}
