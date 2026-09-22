import type { AssetKind, Currency, QuoteSource } from "@/lib/types";
import { getJson } from "./types";

/**
 * Buscar un activo por nombre, contra Yahoo.
 *
 * El catalogo local resuelve al instante y sin red los tickers que la gente
 * nombra seguido, pero es una lista escrita a mano: escribir "Nike" no
 * encontraba nada porque Nike no estaba. Agregar nombres de a uno es una
 * carrera que no se gana.
 *
 * Esto consulta el buscador de Yahoo, que conoce todo lo que cotiza. Es el
 * unico lugar de la app que resuelve nombres a simbolos; el resto ya sabe que
 * hacer con un simbolo.
 */
export interface SymbolHit {
  symbol: string;
  name: string;
  kind: AssetKind;
  currency: Currency;
  source: Exclude<QuoteSource, "manual">;
  sourceSymbol: string;
  precision: number;
  /** Donde cotiza, para desempatar entre homonimos. */
  exchange?: string;
}

interface YahooQuote {
  symbol?: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  exchDisp?: string;
  exchange?: string;
  isYahooFinance?: boolean;
}

const BASE = "https://query1.finance.yahoo.com/v1/finance/search";

/** El vocabulario de Yahoo para el tipo de instrumento, al nuestro. */
function kindOf(quoteType: string | undefined, symbol: string): AssetKind {
  if (symbol.endsWith(".BA")) return "cedear";
  switch ((quoteType ?? "").toUpperCase()) {
    case "ETF":
      return "etf";
    case "MUTUALFUND":
      return "fund";
    case "CRYPTOCURRENCY":
      return "crypto";
    default:
      return "stock";
  }
}

/**
 * Los tickers argentinos llegan con sufijo `.BA`. Se marcan como del mercado
 * local y en pesos, igual que en el catalogo: data912 le saca el sufijo y, si
 * se cae, Yahoo lo atiende con el sufijo puesto.
 */
function sourceOf(symbol: string, quoteType: string | undefined) {
  if (symbol.endsWith(".BA")) {
    return { source: "byma" as const, currency: "ARS" as const, precision: 2 };
  }
  if ((quoteType ?? "").toUpperCase() === "CRYPTOCURRENCY") {
    // El buscador devuelve "BTC-USD"; nuestro proveedor de cripto es Binance,
    // que lo llama "BTCUSDT".
    return { source: "binance" as const, currency: "USD" as const, precision: 8 };
  }
  return { source: "yahoo" as const, currency: "USD" as const, precision: 6 };
}

function sourceSymbolOf(symbol: string, source: string): string {
  if (source === "binance") return `${symbol.replace(/-USD$/i, "").toUpperCase()}USDT`;
  return symbol;
}

export async function searchSymbols(query: string, limit = 8): Promise<SymbolHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const url = `${BASE}?q=${encodeURIComponent(q)}&quotesCount=${limit * 2}&newsCount=0&lang=en-US&region=US`;
  const data = await getJson<{ quotes?: YahooQuote[] }>(url);
  const rows = Array.isArray(data?.quotes) ? data.quotes : [];

  const out: SymbolHit[] = [];
  const vistos = new Set<string>();
  for (const row of rows) {
    const symbol = (row.symbol ?? "").trim();
    // Sin simbolo no hay nada que cargar, y los que Yahoo no cotiza tampoco
    // sirven: la app los mostraria sin precio para siempre.
    if (!symbol || row.isYahooFinance === false) continue;
    const tipo = (row.quoteType ?? "").toUpperCase();
    // Indices, monedas y derivados no son algo que se pueda tener en cartera.
    if (["CURRENCY", "FUTURE", "OPTION", "INDEX"].includes(tipo)) continue;
    if (vistos.has(symbol)) continue;
    vistos.add(symbol);

    const { source, currency, precision } = sourceOf(symbol, row.quoteType);
    out.push({
      symbol: source === "binance" ? symbol.replace(/-USD$/i, "").toUpperCase() : symbol,
      name: row.longname ?? row.shortname ?? symbol,
      kind: kindOf(row.quoteType, symbol),
      currency,
      source,
      sourceSymbol: sourceSymbolOf(symbol, source),
      precision,
      exchange: row.exchDisp ?? row.exchange,
    });
    if (out.length >= limit) break;
  }
  return out;
}
