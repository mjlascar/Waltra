import type { AssetKind, Currency, QuoteSource } from "@/lib/types";

export interface CatalogEntry {
  symbol: string;
  name: string;
  kind: AssetKind;
  currency: Currency;
  source: QuoteSource;
  sourceSymbol: string;
  precision: number;
  /** Como lo puede llamar el usuario al escribir rapido. */
  aliases: string[];
}

const crypto = (symbol: string, name: string, aliases: string[] = []): CatalogEntry => ({
  symbol,
  name,
  kind: "crypto",
  currency: "USD",
  source: "binance",
  sourceSymbol: `${symbol}USDT`,
  precision: 8,
  aliases,
});

const us = (
  symbol: string,
  name: string,
  kind: AssetKind,
  aliases: string[] = [],
): CatalogEntry => ({
  symbol,
  name,
  kind,
  currency: "USD",
  source: "yahoo",
  sourceSymbol: symbol,
  precision: 6,
  aliases,
});

/** Acciones argentinas y CEDEARs que cotizan en BYMA, en pesos. */
const ar = (symbol: string, name: string, kind: AssetKind, aliases: string[] = []): CatalogEntry => ({
  symbol,
  name,
  kind,
  currency: "ARS",
  source: "byma",
  sourceSymbol: symbol,
  precision: 2,
  aliases,
});

export const CATALOG: CatalogEntry[] = [
  // --- Indices y ETFs que la gente nombra por el indice -------------------
  us("QQQ", "Invesco QQQ (Nasdaq 100)", "etf", ["nasdaq", "nasdaq100", "nasdaq 100", "ndx"]),
  us("SPY", "SPDR S&P 500", "etf", ["sp500", "s&p", "s&p500", "spx", "sp 500"]),
  us("VOO", "Vanguard S&P 500", "etf", []),
  us("VTI", "Vanguard Total Stock Market", "etf", ["total market"]),
  us("IWM", "iShares Russell 2000", "etf", ["russell"]),
  us("DIA", "SPDR Dow Jones", "etf", ["dow", "dow jones"]),
  us("EEM", "iShares Emerging Markets", "etf", ["emergentes"]),
  us("GLD", "SPDR Gold", "etf", ["oro", "gold"]),
  us("SLV", "iShares Silver", "etf", ["silver"]),
  us("TLT", "iShares 20+ Year Treasury", "etf", ["bonos largos", "treasury"]),
  us("ARKK", "ARK Innovation", "etf", ["ark"]),

  // --- Acciones populares --------------------------------------------------
  us("AAPL", "Apple", "stock", ["apple", "manzanita"]),
  us("MSFT", "Microsoft", "stock", ["microsoft"]),
  us("GOOGL", "Alphabet", "stock", ["google", "alphabet"]),
  us("AMZN", "Amazon", "stock", ["amazon"]),
  us("META", "Meta Platforms", "stock", ["meta", "facebook"]),
  us("TSLA", "Tesla", "stock", ["tesla"]),
  us("NVDA", "NVIDIA", "stock", ["nvidia"]),
  us("AMD", "AMD", "stock", []),
  us("NFLX", "Netflix", "stock", ["netflix"]),
  us("KO", "Coca-Cola", "stock", ["coca", "coca cola", "cocacola"]),
  us("MELI", "MercadoLibre", "stock", ["mercadolibre", "mercado libre", "meli"]),
  us("NKE", "Nike", "stock", ["nike"]),
  us("SBUX", "Starbucks", "stock", ["starbucks"]),
  us("MCD", "McDonald's", "stock", ["mcdonalds", "mc donalds", "macdonalds"]),
  us("DIS", "Disney", "stock", ["disney"]),
  us("V", "Visa", "stock", ["visa"]),
  us("MA", "Mastercard", "stock", ["mastercard"]),
  us("JPM", "JPMorgan Chase", "stock", ["jpmorgan", "jp morgan"]),
  us("BRK-B", "Berkshire Hathaway B", "stock", ["berkshire", "buffett"]),
  us("XOM", "Exxon Mobil", "stock", ["exxon"]),
  us("PFE", "Pfizer", "stock", ["pfizer"]),
  us("JNJ", "Johnson & Johnson", "stock", ["johnson"]),
  us("WMT", "Walmart", "stock", ["walmart"]),
  us("PEP", "PepsiCo", "stock", ["pepsi", "pepsico"]),
  us("INTC", "Intel", "stock", ["intel"]),
  us("UBER", "Uber", "stock", ["uber"]),
  us("ABNB", "Airbnb", "stock", ["airbnb"]),
  us("SHOP", "Shopify", "stock", ["shopify"]),
  us("PYPL", "PayPal", "stock", ["paypal"]),
  us("COIN", "Coinbase", "stock", ["coinbase"]),
  us("GGAL", "Grupo Galicia (ADR)", "stock", ["galicia"]),
  us("YPF", "YPF (ADR)", "stock", ["ypf"]),
  us("PAM", "Pampa Energia (ADR)", "stock", ["pampa"]),
  us("BMA", "Banco Macro (ADR)", "stock", ["macro"]),

  // --- Cripto --------------------------------------------------------------
  crypto("BTC", "Bitcoin", ["bitcoin", "btc"]),
  crypto("ETH", "Ethereum", ["ethereum", "eth", "ether"]),
  crypto("SOL", "Solana", ["solana"]),
  crypto("BNB", "BNB", ["bnb"]),
  crypto("XRP", "XRP", ["ripple"]),
  crypto("ADA", "Cardano", ["cardano"]),
  crypto("DOGE", "Dogecoin", ["doge", "dogecoin"]),
  crypto("MATIC", "Polygon", ["polygon"]),
  crypto("DOT", "Polkadot", ["polkadot"]),
  crypto("AVAX", "Avalanche", ["avalanche"]),
  crypto("LINK", "Chainlink", ["chainlink"]),
  crypto("LTC", "Litecoin", ["litecoin"]),
  {
    symbol: "USDT",
    name: "Tether",
    kind: "crypto",
    currency: "USD",
    source: "manual",
    sourceSymbol: "USDT",
    precision: 2,
    aliases: ["tether", "usdt"],
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    kind: "crypto",
    currency: "USD",
    source: "manual",
    sourceSymbol: "USDC",
    precision: 2,
    aliases: ["usdc"],
  },

  // --- BYMA / Cocos --------------------------------------------------------
  ar("GGAL.BA", "Grupo Galicia (BYMA)", "stock", ["galicia bolsa"]),
  ar("YPFD.BA", "YPF (BYMA)", "stock", []),
  ar("PAMP.BA", "Pampa Energia (BYMA)", "stock", []),
  ar("ALUA.BA", "Aluar", "stock", ["aluar"]),
  ar("TXAR.BA", "Ternium Argentina", "stock", ["ternium"]),
  ar("AL30", "Bonar 2030", "bond", ["al30"]),
  ar("GD30", "Global 2030", "bond", ["gd30"]),
  {
    symbol: "COCOS AHORRO",
    name: "Cocos Ahorro (FCI money market)",
    kind: "fund",
    currency: "ARS",
    source: "manual",
    sourceSymbol: "COCOS_AHORRO",
    precision: 2,
    aliases: ["cocos ahorro", "ahorro", "money market", "fci", "remunerada"],
  },
];

const byAlias = new Map<string, CatalogEntry>();
for (const entry of CATALOG) {
  byAlias.set(entry.symbol.toLowerCase(), entry);
  byAlias.set(entry.name.toLowerCase(), entry);
  for (const alias of entry.aliases) byAlias.set(alias.toLowerCase(), entry);
}

export function lookupCatalog(term: string): CatalogEntry | undefined {
  return byAlias.get(term.trim().toLowerCase());
}

/** Todos los alias ordenados por longitud descendente, para matchear frases. */
export const CATALOG_ALIASES: string[] = [...byAlias.keys()].sort((a, b) => b.length - a.length);

export function searchCatalog(query: string, limit = 12): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return CATALOG.slice(0, limit);
  const scored: { entry: CatalogEntry; score: number }[] = [];
  for (const entry of CATALOG) {
    const hay = [entry.symbol, entry.name, ...entry.aliases].map((s) => s.toLowerCase());
    let score = 0;
    for (const h of hay) {
      if (h === q) score = Math.max(score, 100);
      else if (h.startsWith(q)) score = Math.max(score, 60);
      else if (h.includes(q)) score = Math.max(score, 30);
    }
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score || a.entry.symbol.localeCompare(b.entry.symbol));
  return scored.slice(0, limit).map((s) => s.entry);
}
