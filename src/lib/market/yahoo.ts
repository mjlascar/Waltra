import type { PricePoint, Split } from "@/lib/types";
import { daysBetween, toDay, today } from "@/lib/date";
import { getJson, type HistoryRequest, type HistoryResult, type MarketRef, type QuoteResult } from "./types";

export interface ChartResponse {
  chart: {
    error?: { description?: string } | null;
    result?: {
      meta: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        currency?: string;
      };
      timestamp?: number[];
      indicators: { quote: { close?: (number | null)[] }[] };
      events?: {
        splits?: Record<
          string,
          { date?: number; numerator?: number; denominator?: number; splitRatio?: string }
        >;
      };
    }[];
  };
}

// Yahoo atiende el mismo endpoint en dos hosts y a veces uno responde 429
// mientras el otro anda. Probar el segundo sale casi gratis.
const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

function chartUrl(host: string, symbol: string, range: string): string {
  // `events=split` trae los splits del periodo. Los cierres que devuelve Yahoo
  // ya vienen divididos por ellos, asi que hacen falta para leer bien la
  // historia: sin ellos, un CEDEAR que cambio de ratio parece haberse caido
  // a la mitad el dia que alguien lo compro.
  return `https://${host}/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?range=${range}&interval=1d&includePrePost=false&events=split`;
}

/**
 * Los splits de una respuesta de Yahoo, como unidades nuevas por unidad vieja.
 *
 * Yahoo los da como numerador y denominador ("5:2" es 2,5). Un split con
 * datos incompletos o absurdos se descarta: aplicar uno equivocado multiplica
 * una posicion entera.
 */
export function parseSplits(data: ChartResponse): Split[] {
  const raw = data.chart?.result?.[0]?.events?.splits ?? {};
  const out: Split[] = [];
  for (const [key, ev] of Object.entries(raw)) {
    const stamp = ev.date ?? Number(key);
    const ratio = ev.numerator && ev.denominator ? ev.numerator / ev.denominator : NaN;
    if (!Number.isFinite(stamp) || !Number.isFinite(ratio) || ratio <= 0 || ratio === 1) continue;
    out.push({ date: toDay(new Date(stamp * 1000)), ratio });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

async function fetchChart(symbol: string, range: string): Promise<ChartResponse> {
  let last: unknown;
  for (const host of HOSTS) {
    try {
      return await getJson<ChartResponse>(chartUrl(host, symbol, range));
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** Rango de Yahoo que cubre los dias pedidos, redondeando para arriba. */
function rangeFor(days: number): string {
  if (days <= 5) return "5d";
  if (days <= 30) return "1mo";
  if (days <= 92) return "3mo";
  if (days <= 186) return "6mo";
  if (days <= 370) return "1y";
  if (days <= 740) return "2y";
  if (days <= 1850) return "5y";
  if (days <= 3700) return "10y";
  return "max";
}

export async function yahooQuote(ref: MarketRef): Promise<QuoteResult> {
  const at = new Date().toISOString();
  try {
    const data = await fetchChart(ref.sourceSymbol, "5d");
    const result = data.chart?.result?.[0];
    if (!result) throw new Error(data.chart?.error?.description ?? "sin datos");
    const price = result.meta.regularMarketPrice ?? null;
    const prev = result.meta.chartPreviousClose ?? result.meta.previousClose;
    return {
      assetId: ref.assetId,
      price,
      currency: ref.currency,
      changePct: price !== null && prev ? price / prev - 1 : undefined,
      at,
      source: "yahoo",
      error: price === null ? "sin precio" : undefined,
    };
  } catch (err) {
    return {
      assetId: ref.assetId,
      price: null,
      currency: ref.currency,
      at,
      source: "yahoo",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function yahooHistory(req: HistoryRequest): Promise<HistoryResult> {
  try {
    const days = Math.max(5, daysBetween(req.from, today()) + 2);
    const data = await fetchChart(req.sourceSymbol, rangeFor(days));
    const result = data.chart?.result?.[0];
    if (!result) throw new Error(data.chart?.error?.description ?? "sin datos");
    const stamps = result.timestamp ?? [];
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    const points: PricePoint[] = [];
    for (let i = 0; i < stamps.length; i++) {
      const close = closes[i];
      if (close === null || close === undefined || !Number.isFinite(close)) continue;
      points.push({ date: toDay(new Date(stamps[i] * 1000)), close });
    }
    return { assetId: req.assetId, currency: req.currency, points, splits: parseSplits(data) };
  } catch (err) {
    return {
      assetId: req.assetId,
      currency: req.currency,
      points: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
