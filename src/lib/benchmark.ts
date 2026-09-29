import type { Currency, PriceSeries } from "@/lib/types";
import type { DayKey } from "@/lib/date";
import { lookupCatalog } from "@/lib/catalog";
import { PriceLookup } from "@/lib/engine/prices";

/**
 * Indice de referencia.
 *
 * Se guarda en la tabla de precios con un id reservado, sin crear un activo:
 * no es algo que el usuario tenga, es una vara para medirse. Asi no aparece
 * en la cartera ni en la lista de activos.
 */
export const BENCHMARK_ASSET_ID = "__benchmark";

export interface BenchmarkRef {
  assetId: string;
  symbol: string;
  source: "binance" | "yahoo" | "byma" | "manual";
  sourceSymbol: string;
  currency: "USD" | "ARS";
}

export function benchmarkRef(symbol: string | undefined): BenchmarkRef | null {
  if (!symbol || symbol === "none") return null;
  const entry = lookupCatalog(symbol);
  if (!entry || entry.source === "manual") return null;
  return {
    assetId: BENCHMARK_ASSET_ID,
    symbol: entry.symbol,
    source: entry.source,
    sourceSymbol: entry.sourceSymbol,
    currency: entry.currency,
  };
}

/**
 * La serie del indice en la moneda en que se muestra la app.
 *
 * Con la app en pesos la cartera rinde en pesos, y eso incluye lo que subio el
 * dolar: compararla contra el S&P 500 en dolares le daria de regalo toda la
 * devaluacion. El indice se pasa a pesos al dolar de cada dia, que es lo que
 * habria rendido comprarlo con pesos. Sin dolar ese dia, el punto no esta.
 */
export function seriesIn(
  series: PriceSeries | undefined,
  base: Currency,
  fxAt: (day: DayKey) => number,
): PriceSeries | undefined {
  if (!series || series.currency === base) return series;
  const points = series.points
    .map((pt) => {
      const fx = fxAt(pt.date);
      if (!(fx > 0)) return null;
      return { date: pt.date, close: base === "ARS" ? pt.close * fx : pt.close / fx };
    })
    .filter((pt): pt is { date: string; close: number } => pt !== null);
  return { ...series, currency: base, points };
}

/**
 * Retorno acumulado del indice desde el primer dia de la ventana, para poder
 * superponerlo con el TWR de la cartera sobre el mismo eje.
 */
export function benchmarkReturns(
  series: PriceSeries | undefined,
  days: DayKey[],
): { day: DayKey; value: number }[] | null {
  if (!series || series.points.length < 2 || days.length === 0) return null;
  const lookup = new PriceLookup([series]);
  const base = lookup.at(series.assetId, days[0]);
  if (base === null || base <= 0) return null;
  return days.map((day) => {
    const close = lookup.at(series.assetId, day) ?? base;
    return { day, value: close / base - 1 };
  });
}

/** Opciones que se ofrecen en Ajustes. */
export const BENCHMARK_CHOICES = [
  { value: "SPY", label: "S&P 500" },
  { value: "QQQ", label: "Nasdaq 100" },
  { value: "BTC", label: "Bitcoin" },
  { value: "GLD", label: "Oro" },
  { value: "none", label: "Ninguno" },
];
