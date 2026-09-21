import type { PricePoint } from "@/lib/types";
import { dayToUtc, toDay } from "@/lib/date";
import { getJson, type HistoryRequest, type HistoryResult, type MarketRef, type QuoteResult } from "./types";

const BASE = "https://api.binance.com";

interface Ticker24h {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
}

/** Cotizaciones de cripto. Un solo pedido para todos los simbolos. */
export async function binanceQuotes(refs: MarketRef[]): Promise<QuoteResult[]> {
  if (refs.length === 0) return [];
  const symbols = [...new Set(refs.map((r) => r.sourceSymbol.toUpperCase()))];
  const at = new Date().toISOString();
  try {
    const query = encodeURIComponent(JSON.stringify(symbols));
    const rows = await getJson<Ticker24h[]>(`${BASE}/api/v3/ticker/24hr?symbols=${query}`);
    const bySymbol = new Map(rows.map((r) => [r.symbol.toUpperCase(), r]));
    return refs.map((ref) => {
      const row = bySymbol.get(ref.sourceSymbol.toUpperCase());
      return {
        assetId: ref.assetId,
        price: row ? Number(row.lastPrice) : null,
        currency: ref.currency,
        changePct: row ? Number(row.priceChangePercent) / 100 : undefined,
        at,
        source: "binance" as const,
        error: row ? undefined : "símbolo no encontrado en Binance",
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return refs.map((ref) => ({
      assetId: ref.assetId,
      price: null,
      currency: ref.currency,
      at,
      source: "binance" as const,
      error: message,
    }));
  }
}

type Kline = [number, string, string, string, string, ...unknown[]];

/** Cierres diarios. Binance devuelve como maximo 1000 velas por pedido. */
export async function binanceHistory(req: HistoryRequest): Promise<HistoryResult> {
  try {
    const points: PricePoint[] = [];
    let startTime = dayToUtc(req.from);
    const now = Date.now();
    for (let page = 0; page < 20; page++) {
      const url = `${BASE}/api/v3/klines?symbol=${encodeURIComponent(
        req.sourceSymbol.toUpperCase(),
      )}&interval=1d&limit=1000&startTime=${startTime}`;
      const rows = await getJson<Kline[]>(url);
      if (rows.length === 0) break;
      for (const row of rows) {
        points.push({ date: toDay(new Date(row[0])), close: Number(row[4]) });
      }
      const last = rows[rows.length - 1][0];
      if (rows.length < 1000 || last >= now) break;
      startTime = last + 86_400_000;
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
