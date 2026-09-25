import type { Asset, PricePoint, Transaction } from "@/lib/types";
import type { DayKey } from "@/lib/date";
import { addDays, toDay } from "@/lib/date";
import { FxTable, toUsd } from "./fx";
import { PriceLookup } from "./prices";
import type { AssetSplit } from "./splits";

/**
 * Los cambios de ratio de un CEDEAR, deducidos de las operaciones.
 *
 * Un CEDEAR es una fraccion de una accion de afuera: el de SPY fue 1/20 de
 * SPY y despues 1/50. Esa fraccion es exactamente el precio de la accion en
 * Nueva York dividido por el precio del CEDEAR en dolares, asi que cada
 * compra y cada venta dice que ratio regia ese dia: pagar US$ 35 con SPY a
 * US$ 700 es 20 a 1; pagar US$ 13,24 con SPY a US$ 660, 50 a 1. La
 * cotizacion de hoy dice el ratio de hoy.
 *
 * Con eso el cambio de ratio sale de los datos y no de la memoria de nadie:
 * cuanto (el cociente entre los ratios de antes y de despues) y cuando (entre
 * la ultima operacion con el ratio viejo y la primera con el nuevo). Cargarlo
 * a mano con la fecha o el numero equivocado fue lo que corrio la cartera dos
 * veces con SPY.BA.
 *
 * La accion se lee de la serie de Yahoo, que viene ajustada por sus propios
 * splits. No hay que deshacerlos: si la accion se divide por 10 y el CEDEAR
 * con ella, el cociente salta por 10, que es justo lo que se multiplicaron
 * las unidades del CEDEAR.
 */

/** La serie de la accion de un CEDEAR se guarda con este id. */
export const underlyingId = (assetId: string) => `sub:${assetId}`;

/** El simbolo de la accion en Nueva York: el del CEDEAR sin el sufijo de BYMA. */
export const underlyingSymbol = (asset: Pick<Asset, "symbol">) =>
  asset.symbol.toUpperCase().replace(/\.BA$/, "");

export interface RatioPoint {
  day: DayKey;
  /** Precio de la accion sobre precio del CEDEAR, en dolares. */
  ratio: number;
  /** Una operacion, o la cotizacion de hoy. */
  from: "operacion" | "hoy";
}

export interface RatioChange {
  /** Ultimo dia visto con el ratio anterior. */
  lastOld: DayKey;
  /** Primer dia visto con el nuevo: el cambio rige, a mas tardar, ese dia. */
  firstNew: DayKey;
  /** Unidades nuevas por cada vieja. Redondeado si esta cerca de un numero redondo. */
  factor: number;
  /** El cociente tal cual salio, antes de redondear. */
  measured: number;
  /** Si se redondeo a un numero conocido o quedo aproximado. */
  exact: boolean;
  /** Solo lo muestra la cotizacion de hoy: todavia no hay una operacion despues. */
  onlyLive: boolean;
  /** Fecha propuesta para registrarlo. */
  date: DayKey;
}

export type RatioIssue =
  | { kind: "falta"; change: RatioChange }
  | { kind: "ratio"; change: RatioChange; registered: number }
  | { kind: "sobra"; split: AssetSplit };

export interface RatioCheck {
  assetId: string;
  symbol: string;
  underlying: string;
  points: RatioPoint[];
  changes: RatioChange[];
  issues: RatioIssue[];
  /**
   * Los cambios de ratio que hay que tener cargados a mano para que todo
   * cierre: los que las operaciones muestran y el proveedor no informa.
   */
  proposal: { date: DayKey; ratio: number }[];
}

/**
 * Cuanto puede separarse una operacion del ratio de su grupo sin ser otro
 * ratio. El dolar MEP contra el CCL, la punta compradora y el momento del dia
 * mueven el cociente unos puntos, y la brecha entre dolares ha llegado a un
 * 10%; ningun cambio de ratio real es menor a 1,5.
 */
const MISMO_RATIO = 0.3;

/** Los multiplicadores que se ven en la practica, y sus inversos. */
const REDONDOS = [1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50];
const CANDIDATOS = [...REDONDOS, ...REDONDOS.map((r) => 1 / r)];

export function snapFactor(measured: number): { factor: number; exact: boolean } {
  let mejor = CANDIDATOS[0];
  for (const c of CANDIDATOS) if (Math.abs(measured / c - 1) < Math.abs(measured / mejor - 1)) mejor = c;
  if (Math.abs(measured / mejor - 1) < 0.07) return { factor: mejor, exact: true };
  return { factor: Number(measured.toFixed(2)), exact: false };
}

const mediana = (xs: number[]) => {
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};
const cerca = (a: number, b: number, tol: number) => Math.abs(a / b - 1) < tol;

/**
 * El dia exacto del cambio, si la serie del CEDEAR lo muestra: una serie
 * cruda cae de golpe en el factor. Una ajustada no muestra nada, y ahi la
 * fecha dentro de la ventana no cambia ningun valor.
 */
function jumpDay(points: PricePoint[], after: DayKey, until: DayKey, factor: number): DayKey | null {
  let prev: PricePoint | null = null;
  for (const p of points) {
    if (p.date > until) break;
    if (prev && p.date > after && prev.close > 0 && cerca((p.close / prev.close) * factor, 1, 0.3)) {
      return p.date;
    }
    prev = p;
  }
  return null;
}

/** Los puntos de un CEDEAR: una por operacion con precio, y la cotizacion de hoy. */
export function ratioPoints(input: {
  asset: Asset;
  transactions: Transaction[];
  prices: PriceLookup;
  fx: FxTable;
  cedearQuote: number | null;
  underlyingQuote: number | null;
  asOf: DayKey;
}): RatioPoint[] {
  const { asset, prices, fx } = input;
  const sub = underlyingId(asset.id);
  const out: RatioPoint[] = [];
  for (const tx of input.transactions) {
    if ((tx.type !== "buy" && tx.type !== "sell") || tx.assetId !== asset.id) continue;
    if (!tx.quantity || !(tx.amount > 0)) continue;
    const day = toDay(tx.date);
    const accion = prices.at(sub, day);
    if (accion === null || !(accion > 0)) continue;
    const rate = tx.fxRate && tx.fxRate > 0 ? tx.fxRate : fx.at(day);
    if (tx.currency === "ARS" && !(rate > 0)) continue;
    const cedear = toUsd(tx.amount, tx.currency, rate) / tx.quantity;
    if (!(cedear > 0)) continue;
    out.push({ day, ratio: accion / cedear, from: "operacion" });
  }
  out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  const accionHoy = input.underlyingQuote ?? prices.latest(sub);
  const dolar = fx.latest;
  if (input.cedearQuote && input.cedearQuote > 0 && accionHoy && accionHoy > 0) {
    const cedearUsd = asset.currency === "ARS" ? (dolar > 0 ? input.cedearQuote / dolar : 0) : input.cedearQuote;
    if (cedearUsd > 0) out.push({ day: input.asOf, ratio: accionHoy / cedearUsd, from: "hoy" });
  }
  return out;
}

/**
 * Los cambios de ratio que muestran los puntos.
 *
 * Se agrupan los puntos consecutivos con el mismo ratio. Un grupo de una sola
 * operacion entre dos que coinciden es un precio mal cargado y no dos cambios
 * de ratio que se anulan: se descarta.
 */
export function ratioChanges(points: RatioPoint[], cedearSeries: PricePoint[] = []): RatioChange[] {
  if (points.length < 2) return [];
  let grupos: RatioPoint[][] = [];
  for (const p of points) {
    const actual = grupos[grupos.length - 1];
    if (actual && cerca(p.ratio, mediana(actual.map((x) => x.ratio)), MISMO_RATIO)) actual.push(p);
    else grupos.push([p]);
  }
  grupos = grupos.filter((g, i) => {
    if (g.length !== 1 || i === 0 || i === grupos.length - 1) return true;
    const antes = mediana(grupos[i - 1].map((x) => x.ratio));
    const despues = mediana(grupos[i + 1].map((x) => x.ratio));
    return !cerca(antes, despues, MISMO_RATIO);
  });
  // Descartar uno puede dejar juntos dos grupos iguales: se vuelven a unir.
  const unidos: RatioPoint[][] = [];
  for (const g of grupos) {
    const ultimo = unidos[unidos.length - 1];
    if (ultimo && cerca(mediana(g.map((x) => x.ratio)), mediana(ultimo.map((x) => x.ratio)), MISMO_RATIO)) {
      ultimo.push(...g);
    } else unidos.push([...g]);
  }

  const out: RatioChange[] = [];
  for (let i = 1; i < unidos.length; i++) {
    const viejo = unidos[i - 1];
    const nuevo = unidos[i];
    const measured = mediana(nuevo.map((x) => x.ratio)) / mediana(viejo.map((x) => x.ratio));
    const { factor, exact } = snapFactor(measured);
    const lastOld = viejo[viejo.length - 1].day;
    const firstNew = nuevo[0].day;
    const onlyLive = nuevo.every((x) => x.from === "hoy");
    const salto = jumpDay(cedearSeries, lastOld, firstNew, factor);
    out.push({
      lastOld,
      firstNew,
      factor,
      measured,
      exact,
      onlyLive,
      // Con la serie cruda, el dia del salto. Si no, el de la primera
      // operacion al ratio nuevo: rige desde que abre el mercado, asi que
      // esa operacion ya queda en unidades nuevas. Si solo lo muestra la
      // cotizacion de hoy, el dia siguiente a la ultima operacion: con los
      // precios ajustados del proveedor, cualquier dia de la ventana vale
      // lo mismo.
      date: salto ?? (onlyLive ? addDays(lastOld, 1) : firstNew),
    });
  }
  return out;
}

/** Un cambio esta registrado si los splits cargados en su ventana suman el mismo factor. */
function registradoEn(change: RatioChange, splits: AssetSplit[]): number | null {
  const dentro = splits.filter((s) => s.date > change.lastOld && s.date <= change.firstNew);
  if (dentro.length === 0) return null;
  return dentro.reduce((f, s) => f * s.ratio, 1);
}

/**
 * Lo que las operaciones dicen contra lo que esta cargado.
 *
 * Un split cargado fuera de toda ventana, con operaciones de un mismo ratio a
 * los dos lados, esta de mas: las operaciones de antes y de despues dicen que
 * nada cambio ahi.
 */
export function checkRatios(input: {
  asset: Asset;
  points: RatioPoint[];
  changes: RatioChange[];
  splits: AssetSplit[];
}): RatioCheck {
  const { asset, points, changes, splits } = input;
  const issues: RatioIssue[] = [];
  const proposal: { date: DayKey; ratio: number }[] = [];

  for (const change of changes) {
    const registrado = registradoEn(change, splits);
    if (registrado === null) issues.push({ kind: "falta", change });
    else if (!cerca(registrado, change.factor, change.exact ? 0.02 : 0.1)) {
      issues.push({ kind: "ratio", change, registered: registrado });
    }
    // Lo que informa el proveedor dentro de la ventana ya esta aplicado; a
    // mano solo va lo que falta para llegar al factor.
    const delProveedor = splits
      .filter((s) => s.source === "proveedor" && s.date > change.lastOld && s.date <= change.firstNew)
      .reduce((f, s) => f * s.ratio, 1);
    const resto = change.factor / delProveedor;
    if (!cerca(resto, 1, 0.02)) proposal.push({ date: change.date, ratio: Number(resto.toFixed(4)) });
  }

  if (points.length >= 2) {
    const primero = points[0].day;
    const ultimo = points[points.length - 1].day;
    for (const s of splits) {
      if (s.source !== "manual") continue;
      if (s.date <= primero || s.date > ultimo) continue;
      if (changes.some((c) => s.date > c.lastOld && s.date <= c.firstNew)) continue;
      issues.push({ kind: "sobra", split: s });
    }
  }

  return {
    assetId: asset.id,
    symbol: asset.symbol,
    underlying: underlyingSymbol(asset),
    points,
    changes,
    issues,
    proposal,
  };
}

/**
 * Cuantas unidades quedan con un juego de splits. Sirve para mostrar, antes
 * de aplicar nada, el numero que hay que comparar con el del broker.
 */
export function unitsWith(
  transactions: Transaction[],
  assetId: string,
  splits: { date: DayKey; ratio: number }[],
): number {
  let total = 0;
  for (const tx of transactions) {
    if (tx.assetId !== assetId || !tx.quantity) continue;
    const signo = tx.type === "buy" ? 1 : tx.type === "sell" ? -1 : 0;
    if (!signo) continue;
    const day = toDay(tx.date);
    // Un split rige desde que abre el mercado: la operacion de ese mismo
    // dia ya esta en unidades nuevas.
    const f = splits.reduce((acc, s) => (s.date > day ? acc * s.ratio : acc), 1);
    total += signo * tx.quantity * f;
  }
  return total;
}
