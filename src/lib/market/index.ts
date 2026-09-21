import type { FxRate } from "@/lib/types";
import { binanceHistory, binanceQuotes } from "./binance";
import { bymaHistory, bymaQuotes } from "./byma";
import { fxHistory, fxLatest } from "./fx";
import { MOCK_ENABLED, mockFx, mockHistory, mockQuotes } from "./mock";
import { yahooHistory, yahooQuote } from "./yahoo";
import type { HistoryRequest, HistoryResult, MarketRef, QuoteResult } from "./types";

export type { HistoryRequest, HistoryResult, MarketRef, QuoteResult };
export { MOCK_ENABLED };

function manualQuotes(refs: MarketRef[]): QuoteResult[] {
  const at = new Date().toISOString();
  return refs.map((ref) => ({
    assetId: ref.assetId,
    price: null,
    currency: ref.currency,
    at,
    source: "manual" as const,
    error: "precio manual: se toma el que cargaste a mano",
  }));
}

/** Cotizaciones de todos los activos, agrupadas por proveedor. */
export async function fetchQuotes(refs: MarketRef[]): Promise<QuoteResult[]> {
  if (refs.length === 0) return [];
  if (MOCK_ENABLED) return mockQuotes(refs);

  const groups: Record<string, MarketRef[]> = { binance: [], yahoo: [], byma: [], manual: [] };
  for (const ref of refs) (groups[ref.source] ??= []).push(ref);

  const tasks: Promise<QuoteResult[]>[] = [
    binanceQuotes(groups.binance),
    Promise.all(groups.yahoo.map(yahooQuote)),
    bymaQuotes(groups.byma),
    Promise.resolve(manualQuotes(groups.manual)),
  ];

  const settled = await Promise.allSettled(tasks);
  const out: QuoteResult[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") out.push(...result.value);
  }
  // Un proveedor caido no puede hacer desaparecer activos de la lista.
  const seen = new Set(out.map((q) => q.assetId));
  const at = new Date().toISOString();
  for (const ref of refs) {
    if (!seen.has(ref.assetId)) {
      out.push({
        assetId: ref.assetId,
        price: null,
        currency: ref.currency,
        at,
        source: ref.source,
        error: "el proveedor no respondió",
      });
    }
  }
  return out;
}

export async function fetchHistory(req: HistoryRequest): Promise<HistoryResult> {
  if (MOCK_ENABLED) return mockHistory(req);
  switch (req.source) {
    case "binance":
      return binanceHistory(req);
    case "byma":
      return bymaHistory(req);
    case "yahoo":
      return yahooHistory(req);
    default:
      return { assetId: req.assetId, currency: req.currency, points: [] };
  }
}

export async function fetchFx(from: string): Promise<{ rates: FxRate[]; latest: FxRate | null }> {
  if (MOCK_ENABLED) {
    const rates = mockFx(from);
    return { rates, latest: rates[rates.length - 1] ?? null };
  }
  const [history, latest] = await Promise.all([fxHistory(), fxLatest()]);
  const rates = history.filter((r) => r.date >= from);
  if (latest && (rates.length === 0 || rates[rates.length - 1].date < latest.date)) {
    rates.push(latest);
  }
  return { rates, latest: latest ?? rates[rates.length - 1] ?? null };
}
