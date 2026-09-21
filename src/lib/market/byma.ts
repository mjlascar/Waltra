import { getJson, type HistoryRequest, type HistoryResult, type MarketRef, type QuoteResult } from "./types";
import { yahooHistory, yahooQuote } from "./yahoo";

const BASE = "https://data912.com";

/**
 * data912 publica el mercado argentino en vivo y gratis. El esquema de campos
 * no esta versionado, asi que leemos cualquiera de los nombres razonables en
 * vez de atarnos a uno.
 */
interface LiveRow {
  symbol?: string;
  ticker?: string;
  c?: number;
  close?: number;
  last?: number;
  px_ask?: number;
  px_bid?: number;
  pct_change?: number;
  variation?: number;
}

const FEEDS = ["arg_stocks", "arg_cedears", "arg_bonds"] as const;

function rowPrice(row: LiveRow): number | null {
  const direct = row.c ?? row.close ?? row.last;
  if (typeof direct === "number" && Number.isFinite(direct) && direct > 0) return direct;
  // Sin ultimo operado, el punto medio del libro es mejor que nada.
  const { px_ask: ask, px_bid: bid } = row;
  if (typeof ask === "number" && typeof bid === "number" && ask > 0 && bid > 0) {
    return (ask + bid) / 2;
  }
  return null;
}

async function loadBoard(): Promise<Map<string, LiveRow>> {
  const board = new Map<string, LiveRow>();
  const results = await Promise.allSettled(
    FEEDS.map((feed) => getJson<LiveRow[]>(`${BASE}/live/${feed}`)),
  );
  for (const result of results) {
    if (result.status !== "fulfilled" || !Array.isArray(result.value)) continue;
    for (const row of result.value) {
      const symbol = (row.symbol ?? row.ticker ?? "").toUpperCase();
      if (symbol) board.set(symbol, row);
    }
  }
  if (board.size === 0) throw new Error("data912 no devolvió ningún panel");
  return board;
}

/** El simbolo BYMA sin el sufijo que usa Yahoo: GGAL.BA -> GGAL. */
function bymaSymbol(sourceSymbol: string): string {
  return sourceSymbol.toUpperCase().replace(/\.BA$/, "");
}

export async function bymaQuotes(refs: MarketRef[]): Promise<QuoteResult[]> {
  if (refs.length === 0) return [];
  const at = new Date().toISOString();
  let board: Map<string, LiveRow> | null = null;
  let boardError = "";
  try {
    board = await loadBoard();
  } catch (err) {
    boardError = err instanceof Error ? err.message : String(err);
  }

  return Promise.all(
    refs.map(async (ref) => {
      const row = board?.get(bymaSymbol(ref.sourceSymbol));
      const price = row ? rowPrice(row) : null;
      if (price !== null) {
        const change = row?.pct_change ?? row?.variation;
        return {
          assetId: ref.assetId,
          price,
          currency: ref.currency,
          changePct: typeof change === "number" ? change / 100 : undefined,
          at,
          source: "byma" as const,
        };
      }
      // Respaldo: Yahoo tambien lista BYMA con el sufijo .BA.
      const fallbackSymbol = ref.sourceSymbol.toUpperCase().endsWith(".BA")
        ? ref.sourceSymbol
        : `${ref.sourceSymbol}.BA`;
      const quote = await yahooQuote({ ...ref, sourceSymbol: fallbackSymbol });
      return {
        ...quote,
        source: "byma" as const,
        error: quote.error ? `${boardError || "sin dato en data912"}; Yahoo: ${quote.error}` : undefined,
      };
    }),
  );
}

/** data912 solo da tiempo real, asi que la historia viene de Yahoo. */
export async function bymaHistory(req: HistoryRequest): Promise<HistoryResult> {
  const symbol = req.sourceSymbol.toUpperCase().endsWith(".BA")
    ? req.sourceSymbol
    : `${req.sourceSymbol}.BA`;
  return yahooHistory({ ...req, sourceSymbol: symbol });
}
