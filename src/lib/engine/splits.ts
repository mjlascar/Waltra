import type { PricePoint, PriceSeries, Transaction } from "@/lib/types";
import type { DayKey } from "@/lib/date";
import { daysBetween, toDay } from "@/lib/date";

/**
 * Splits y cambios de ratio.
 *
 * Cuando un CEDEAR cambia de ratio (20 CEDEARs por accion pasan a ser 50),
 * cada unidad vieja se convierte en 2,5 nuevas que valen 2,5 veces menos. La
 * plata no cambia; cambia como se cuenta. Hay que registrarlo en dos lugares:
 *
 * - En las unidades: desde ese dia la posicion tiene 2,5 veces mas, y el costo
 *   por unidad es 2,5 veces menor. Sin esto, "vendí todo" vende de menos y el
 *   precio de hoy se compara contra un costo de otra escala.
 * - En la historia de precios: Yahoo entrega los cierres viejos ya divididos
 *   por el ratio, en unidades de hoy. Multiplicarlos por las unidades viejas
 *   hace que el dia de la compra la posicion valga 2,5 veces menos de lo que
 *   costo. Fue exactamente lo que se vio con SPY.BA.
 *
 * Un split puede venir del proveedor (junto con la serie) o cargarse a mano,
 * para cuando el proveedor no lo informa.
 */
export interface AssetSplit {
  date: DayKey;
  /** Unidades nuevas por cada unidad vieja. */
  ratio: number;
  source: "proveedor" | "manual";
  /**
   * Si la serie de precios guardada ya viene ajustada por este split (los
   * cierres anteriores divididos por el ratio). Yahoo ajusta; una serie que
   * muestra el salto el dia del split, no.
   */
  adjusted: boolean;
  /** El movimiento, si se cargo a mano: para poder corregirle la fecha. */
  txId?: string;
}

/** Dos registros del mismo split: cerca en el tiempo y con el mismo ratio. */
function mismoSplit(a: { date: DayKey; ratio: number }, b: { date: DayKey; ratio: number }): boolean {
  return Math.abs(daysBetween(a.date, b.date)) <= 10 && Math.abs(a.ratio / b.ratio - 1) < 0.02;
}

/**
 * Si la serie ya esta ajustada por un split.
 *
 * Se mira el salto entre el ultimo cierre antes del split y el primero desde
 * ese dia. Si el precio cae en el ratio, la serie es cruda: el salto esta en
 * los datos y no hay que corregir nada. Si sigue de largo, alguien ya dividio
 * los cierres viejos. Sin datos a los dos lados no se puede saber, y se
 * asume lo que hace Yahoo, que es ajustar.
 */
export function seriesAdjustedFor(points: PricePoint[], split: { date: DayKey; ratio: number }): boolean {
  let antes: number | undefined;
  let despues: number | undefined;
  for (const p of points) {
    if (p.date < split.date) antes = p.close;
    else {
      despues = p.close;
      break;
    }
  }
  if (!antes || !despues) return true;
  const salto = despues / antes;
  // Crudo: el precio se dividio por el ratio de un dia al otro. Un 30% de
  // margen alcanza y sobra, porque ningun dia normal mueve el precio 2,5 veces.
  return Math.abs(salto * split.ratio - 1) >= 0.3;
}

/**
 * Los splits de cada activo: los cargados a mano y los del proveedor, sin
 * repetir. Si los dos informan el mismo, queda el manual, que es el que ya
 * esta en el ledger como movimiento.
 */
export function collectSplits(
  transactions: Transaction[],
  series: PriceSeries[],
): Record<string, AssetSplit[]> {
  const out: Record<string, AssetSplit[]> = {};
  const puntos = new Map(series.map((s) => [s.assetId, s.points]));

  for (const tx of transactions) {
    if (tx.type !== "split" || !tx.assetId || !tx.ratio || tx.ratio <= 0 || tx.ratio === 1) continue;
    const date = toDay(tx.date);
    (out[tx.assetId] ??= []).push({
      date,
      ratio: tx.ratio,
      source: "manual",
      adjusted: seriesAdjustedFor(puntos.get(tx.assetId) ?? [], { date, ratio: tx.ratio }),
      txId: tx.id,
    });
  }

  for (const s of series) {
    for (const split of s.splits ?? []) {
      const lista = (out[s.assetId] ??= []);
      if (lista.some((m) => mismoSplit(m, split))) continue;
      lista.push({
        date: split.date,
        ratio: split.ratio,
        source: "proveedor",
        adjusted: seriesAdjustedFor(s.points, split),
      });
    }
  }

  for (const lista of Object.values(out)) lista.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

/**
 * Por cuanto multiplicar un cierre de la serie para tener el precio que
 * realmente tenia ese dia: el producto de los ratios de los splits
 * posteriores por los que la serie esta ajustada.
 */
export function priceFactor(splits: AssetSplit[] | undefined, day: DayKey): number {
  let f = 1;
  for (const s of splits ?? []) if (s.adjusted && s.date > day) f *= s.ratio;
  return f;
}

/**
 * En cuantas unidades de hoy se convirtio una unidad de ese dia. Sirve para
 * comparar una compra vieja con el precio actual: 9 CEDEARs a $ 50.705 antes
 * de un 2,5 son 22,5 a $ 20.282.
 */
export function unitsFactor(splits: AssetSplit[] | undefined, day: DayKey): number {
  let f = 1;
  for (const s of splits ?? []) if (s.date > day) f *= s.ratio;
  return f;
}

/**
 * Los splits del proveedor como movimientos, para que el ledger los aplique
 * igual que uno cargado a mano. Son internos al calculo: no se guardan ni se
 * muestran en la lista de movimientos.
 */
export function providerSplitTransactions(
  splits: Record<string, AssetSplit[]>,
  transactions: Transaction[],
  currencyOf: (assetId: string) => Transaction["currency"],
): Transaction[] {
  // Solo importan los splits posteriores a la primera operacion del activo:
  // uno de hace diez años no toca una posicion abierta el año pasado, y
  // meterlo haria arrancar la historia de la cartera en esa fecha. Por lo
  // mismo, los del indice de referencia, que no tiene operaciones, quedan
  // afuera.
  const primera = new Map<string, DayKey>();
  for (const tx of transactions) {
    if (!tx.assetId || tx.type === "split") continue;
    const day = toDay(tx.date);
    const ya = primera.get(tx.assetId);
    if (!ya || day < ya) primera.set(tx.assetId, day);
  }
  const out: Transaction[] = [];
  for (const [assetId, lista] of Object.entries(splits)) {
    const desde = primera.get(assetId);
    if (!desde) continue;
    for (const s of lista) {
      if (s.source !== "proveedor" || s.date <= desde) continue;
      out.push({
        id: `split:${assetId}:${s.date}`,
        date: s.date,
        type: "split",
        accountId: "",
        assetId,
        ratio: s.ratio,
        amount: 0,
        currency: currencyOf(assetId),
        // Vacio: ordena primero en el dia. Un split rige desde que abre el
        // mercado, antes de cualquier operacion de esa fecha.
        createdAt: "",
        updatedAt: "",
      });
    }
  }
  return out;
}
