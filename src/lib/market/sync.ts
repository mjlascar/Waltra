import { z } from "zod";
import type { FxRate } from "@/lib/types";
import { MOCK_ENABLED, fetchFx, fetchHistory, fetchQuotes } from "@/lib/market";
import type { HistoryResult, MarketRef, QuoteResult } from "@/lib/market";

/**
 * Una pasada de sincronizacion de mercado: cotizaciones, las series que
 * falten y el tipo de cambio.
 *
 * Vive aca y no en la ruta /api porque corre en dos lugares: en el servidor
 * cuando la app es web, y en el propio telefono cuando es APK. La logica es la
 * misma; lo unico que cambia es quien la ejecuta.
 */

const RefSchema = z.object({
  assetId: z.string().min(1),
  symbol: z.string().min(1),
  source: z.enum(["binance", "yahoo", "byma", "manual"]),
  sourceSymbol: z.string().min(1),
  currency: z.enum(["USD", "ARS"]),
});

export const SyncRequestSchema = z.object({
  refs: z.array(RefSchema).max(200).default([]),
  /** Activos para los que ademas queremos la serie historica. */
  history: z.array(z.string()).max(200).default([]),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  includeFx: z.boolean().default(true),
});

export type SyncRequest = z.input<typeof SyncRequestSchema>;

export interface SyncResult {
  quotes: QuoteResult[];
  history: HistoryResult[];
  fx: FxRate[];
  fxLatest: FxRate | null;
  mock: boolean;
  at: string;
}

export async function syncMarket(input: z.output<typeof SyncRequestSchema>): Promise<SyncResult> {
  const { refs, history, from, includeFx } = input;
  const since = from ?? new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);

  const wanted = new Set(history);
  const historyRefs: MarketRef[] = refs.filter((r) => wanted.has(r.assetId));

  const [quotes, historyResults, fx] = await Promise.all([
    fetchQuotes(refs),
    // Los proveedores se consultan en paralelo pero de a tandas chicas para
    // no gatillar los limites de rate de Yahoo.
    runBatched(historyRefs, 6, (ref) => fetchHistory({ ...ref, from: since })),
    includeFx ? fetchFx(since) : Promise.resolve({ rates: [], latest: null }),
  ]);

  return {
    quotes,
    history: historyResults,
    fx: fx.rates,
    fxLatest: fx.latest,
    mock: MOCK_ENABLED,
    at: new Date().toISOString(),
  };
}

async function runBatched<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = await Promise.allSettled(items.slice(i, i + size).map(fn));
    for (const r of batch) if (r.status === "fulfilled") out.push(r.value);
  }
  return out;
}
