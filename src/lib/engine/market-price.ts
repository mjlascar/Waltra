import type { Asset, Currency, FxRate, PriceSeries, Quote } from "@/lib/types";
import type { DayKey } from "@/lib/date";
import { daysBetween } from "@/lib/date";
import { FxTable } from "./fx";
import { priceFactor, type AssetSplit } from "./splits";

/**
 * Lo que cotizaba un activo un dia dado, en la moneda de la operacion.
 *
 * Existe para la carga de una compra o una venta. La posicion se valua a la
 * cotizacion, asi que si las unidades salen de un precio que no es el del
 * mercado, la diferencia aparece como ganancia (o perdida) en el mismo
 * momento de guardar: comprar hoy $ 450.000 de SPY escribiendo un precio
 * viejo daba rendimiento el dia de la compra. Con la referencia a la vista,
 * el formulario la propone y avisa si lo escrito se aleja.
 */
export interface MarketPrice {
  /** Por unidad, en la moneda pedida y en las unidades de ese dia. */
  price: number;
  currency: Currency;
  /** El dia del cierre usado, o el de hoy si es la cotizacion en vivo. */
  day: DayKey;
  live: boolean;
}

/** Mas de una semana sin cierre es otra cotizacion, no la de ese dia. */
const MAX_GAP_DAYS = 7;

export function marketPriceOn(
  input: {
    asset: Asset;
    day: DayKey;
    currency: Currency;
    today: DayKey;
    quotes: Quote[];
    priceSeries: PriceSeries[];
    fxRates: FxRate[];
    splits?: AssetSplit[];
  },
): MarketPrice | null {
  const { asset, day, currency, today } = input;
  let price: number | null = null;
  let at: DayKey = day;
  let live = false;

  // Hoy manda la cotizacion en vivo, que es la que usa la valuacion.
  const quote = day >= today ? input.quotes.find((q) => q.assetId === asset.id) : undefined;
  if (quote && quote.price > 0 && quote.currency === asset.currency) {
    price = quote.price;
    live = true;
  } else {
    const points = input.priceSeries.find((s) => s.assetId === asset.id)?.points ?? [];
    // Ultimo cierre en o antes del dia: un sabado vale el del viernes.
    let best: { date: DayKey; close: number } | null = null;
    for (const p of points) {
      if (p.date <= day && p.close > 0 && (!best || p.date > best.date)) best = p;
    }
    if (best && daysBetween(best.date, day) <= MAX_GAP_DAYS) {
      // La serie viene ajustada por los splits posteriores; el precio de ese
      // dia, en las unidades de ese dia, es el cierre sin ese ajuste.
      price = best.close * priceFactor(input.splits, day);
      at = best.date;
    }
  }
  if (price === null) return null;

  if (asset.currency !== currency) {
    const fx = new FxTable(input.fxRates, 0);
    const rate = live ? fx.latest : fx.at(day);
    if (!(rate > 0)) return null;
    price = asset.currency === "ARS" ? price / rate : price * rate;
  }
  return { price, currency, day: live ? today : at, live };
}
