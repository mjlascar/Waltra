import { NextResponse } from "next/server";
import { checkAccess } from "@/lib/api-auth";
import { MOCK_ENABLED } from "@/lib/market";
import { resolveModel } from "@/lib/insights/models";
import { binanceQuotes } from "@/lib/market/binance";
import { bymaQuotes } from "@/lib/market/byma";
import { yahooQuote } from "@/lib/market/yahoo";
import { fxLatest } from "@/lib/market/fx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Diagnostico de proveedores. Existe porque las fuentes de datos son APIs
 * publicas gratuitas que pueden caerse o bloquear por region: cuando algo no
 * cotiza, esta pantalla dice cual de las cuatro fallo en vez de dejarte
 * adivinando.
 */
export async function GET(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;

  // ?light=1 responde solo la configuracion, sin golpear a los proveedores.
  // La usa la pantalla de Insights al abrir, que solo necesita saber si hay
  // clave cargada: probar las cuatro fuentes ahi seria gasto al pedo.
  if (new URL(request.url).searchParams.get("light") === "1") {
    return NextResponse.json({
      mock: MOCK_ENABLED,
      aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
      model: resolveModel(undefined),
      providers: [],
      at: new Date().toISOString(),
    });
  }

  const started = Date.now();
  const probe = async (name: string, run: () => Promise<boolean>) => {
    const t0 = Date.now();
    try {
      const ok = await run();
      return { name, ok, ms: Date.now() - t0, error: ok ? undefined : "sin datos" };
    } catch (err) {
      return {
        name,
        ok: false,
        ms: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  const providers = await Promise.all([
    probe("Binance (cripto)", async () => {
      const [q] = await binanceQuotes([
        { assetId: "probe", symbol: "BTC", source: "binance", sourceSymbol: "BTCUSDT", currency: "USD" },
      ]);
      return q?.price !== null && q?.price !== undefined;
    }),
    probe("Yahoo Finance (acciones y ETFs)", async () => {
      const q = await yahooQuote({
        assetId: "probe",
        symbol: "SPY",
        source: "yahoo",
        sourceSymbol: "SPY",
        currency: "USD",
      });
      return q.price !== null;
    }),
    probe("data912 (BYMA)", async () => {
      const [q] = await bymaQuotes([
        { assetId: "probe", symbol: "GGAL", source: "byma", sourceSymbol: "GGAL", currency: "ARS" },
      ]);
      return q?.price !== null && q?.price !== undefined;
    }),
    probe("Dólar MEP", async () => (await fxLatest()) !== null),
  ]);

  return NextResponse.json({
    mock: MOCK_ENABLED,
    aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    model: resolveModel(undefined),
    providers,
    totalMs: Date.now() - started,
    at: new Date().toISOString(),
  });
}
