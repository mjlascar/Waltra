import type { PricePoint } from "@/lib/types";
import { daysBetween, toDay, today } from "@/lib/date";
import { getJson, type HistoryRequest, type HistoryResult, type MarketRef, type QuoteResult } from "./types";

interface ChartResponse {
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
    }[];
  };
}

function chartUrl(symbol: string, range: string): string {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?range=${range}&interval=1d&includePrePost=false`;
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
    const data = await getJson<ChartResponse>(chartUrl(ref.sourceSymbol, "5d"));
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
    const data = await getJson<ChartResponse>(chartUrl(req.sourceSymbol, rangeFor(days)));
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
    return { assetId: req.assetId, currency: req.currency, points };
  } catch (err) {
    return {
      assetId: req.assetId,
      currency: req.currency,
      points: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
