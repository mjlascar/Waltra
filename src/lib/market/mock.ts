import type { PricePoint } from "@/lib/types";
import { addDays, daysBetween, today } from "@/lib/date";
import type { HistoryRequest, HistoryResult, MarketRef, QuoteResult } from "./types";

/**
 * Proveedor simulado, solo para desarrollo y pruebas de interfaz.
 *
 * Se activa unicamente con WALTRA_MOCK=1 y la respuesta de la API viaja
 * marcada como simulada para que la app lo avise en pantalla: mostrar precios
 * inventados como si fueran reales seria el peor error posible en una app de
 * plata.
 */

/** Hash estable de un texto: la misma serie en cada recarga. */
function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE_PRICE: Record<string, number> = {
  BTCUSDT: 96_000,
  ETHUSDT: 3_400,
  SOLUSDT: 180,
  QQQ: 495,
  SPY: 590,
  VOO: 540,
  AAPL: 228,
  NVDA: 138,
  TSLA: 250,
  MELI: 1_900,
  KO: 62,
};

function basePrice(symbol: string): number {
  const known = BASE_PRICE[symbol.toUpperCase()];
  if (known) return known;
  const rand = mulberry32(seedOf(symbol));
  return 20 + rand() * 480;
}

/** Camino aleatorio reproducible con deriva suave y volatilidad por tipo. */
function walk(symbol: string, from: string, to: string): PricePoint[] {
  const days = Math.max(1, daysBetween(from, to) + 1);
  const rand = mulberry32(seedOf(symbol));
  const isCrypto = symbol.toUpperCase().endsWith("USDT");
  const vol = isCrypto ? 0.035 : 0.011;
  const drift = isCrypto ? 0.0012 : 0.0004;
  const end = basePrice(symbol);

  const returns: number[] = [];
  for (let i = 0; i < days; i++) {
    // Box-Muller para que la distribucion tenga colas creibles.
    const u = Math.max(rand(), 1e-9);
    const v = rand();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    returns.push(drift + z * vol);
  }
  // Normalizamos hacia atras para terminar exactamente en el precio base.
  let cumulative = 0;
  for (const r of returns) cumulative += r;
  const start = end / Math.exp(cumulative);

  const points: PricePoint[] = [];
  let price = start;
  let day = from;
  for (let i = 0; i < days; i++) {
    price *= Math.exp(returns[i]);
    points.push({ date: day, close: Number(price.toFixed(isCrypto ? 2 : 2)) });
    day = addDays(day, 1);
  }
  return points;
}

export function mockQuotes(refs: MarketRef[]): QuoteResult[] {
  const at = new Date().toISOString();
  const to = today();
  return refs.map((ref) => {
    const series = walk(ref.sourceSymbol, addDays(to, -3), to);
    const last = series[series.length - 1].close;
    const prev = series[series.length - 2]?.close ?? last;
    return {
      assetId: ref.assetId,
      price: last,
      currency: ref.currency,
      changePct: prev > 0 ? last / prev - 1 : undefined,
      at,
      source: ref.source,
    };
  });
}

export function mockHistory(req: HistoryRequest): HistoryResult {
  return {
    assetId: req.assetId,
    currency: req.currency,
    points: walk(req.sourceSymbol, req.from, today()),
  };
}

export function mockFx(from: string): { date: string; arsPerUsd: number }[] {
  const points = walk("ARSMEP", from, today());
  // Escalamos el camino a un rango plausible de pesos por dolar.
  const last = points[points.length - 1].close;
  const factor = 1_250 / last;
  return points.map((p) => ({ date: p.date, arsPerUsd: Number((p.close * factor).toFixed(2)) }));
}

export const MOCK_ENABLED = process.env.WALTRA_MOCK === "1";
