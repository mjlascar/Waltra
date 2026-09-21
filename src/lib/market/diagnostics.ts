import { MOCK_ENABLED } from "@/lib/market";
import { binanceQuotes } from "@/lib/market/binance";
import { bymaQuotes } from "@/lib/market/byma";
import { yahooQuote } from "@/lib/market/yahoo";
import { fxLatest } from "@/lib/market/fx";

/**
 * Diagnostico de proveedores.
 *
 * Existe porque las fuentes de datos son APIs publicas gratuitas que pueden
 * caerse o bloquear por region: cuando algo no cotiza, esta pantalla dice cual
 * de las cuatro fallo en vez de dejarte adivinando. En el APK ademas sirve
 * para verificar que el transporte nativo esta saliendo de verdad.
 */
export interface ProviderProbe {
  name: string;
  ok: boolean;
  ms: number;
  error?: string;
}

export interface Diagnostics {
  mock: boolean;
  aiConfigured: boolean;
  model: string;
  providers: ProviderProbe[];
  totalMs?: number;
  at: string;
}

export async function probeProviders(): Promise<{ providers: ProviderProbe[]; totalMs: number }> {
  const started = Date.now();
  const probe = async (name: string, run: () => Promise<boolean>): Promise<ProviderProbe> => {
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

  return { providers, totalMs: Date.now() - started };
}

export { MOCK_ENABLED };
