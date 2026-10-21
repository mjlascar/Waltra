import type { Currency, TxType } from "@/lib/types";
import { DOLARES } from "@/lib/parse/binance";
import type { Convert, Deposit, Fill, FiatOrder, FiatPayment, P2POrder, Withdrawal } from "./api";

/**
 * De lo que cuenta Binance a movimientos de Waltra.
 *
 * Funciones puras: reciben un registro de Binance y devuelven los movimientos
 * que lo explican, sin tocar la base. Las reglas son las de la app:
 *
 * - En una cuenta de Binance, los dolares estables (USDT, FDUSD, USDC...) son
 *   el efectivo en dolares, igual que en la importacion del archivo. Los pesos
 *   son el efectivo en pesos. Lo demas es un activo.
 * - Comprar y vender es comprar y vender, sea por el libro de ordenes, por
 *   Convert o por P2P. Entre dos criptos (ETH contra BTC) son dos movimientos,
 *   una venta y una compra, al precio en dolares de ese momento: Waltra lleva
 *   la cuenta en dolares y un costo en BTC no se puede comparar con nada.
 * - Lo que entra de afuera es capital; lo que sale, tambien. Una cripto que
 *   llega de otra billetera es un ingreso por lo que valia y una compra al
 *   mismo precio; una que se va, una venta y un retiro. Asi la ganancia que
 *   hizo mientras estuvo aca queda contada, y la de afuera no.
 * - La comision se cobra en lo que se recibe (unidades de menos), en la moneda
 *   de cotizacion (efectivo de menos) o en BNB (BNB de menos, un ajuste).
 *   Cada caso se registra como lo que fue, para que las unidades cierren con
 *   las de Binance.
 *
 * El id de cada movimiento sale del registro de Binance: leer dos veces lo
 * mismo no duplica nada, y una orden spot tiene el mismo id que si se hubiera
 * importado del archivo de ordenes.
 */

export interface Draft {
  id: string;
  /** Cuando paso, en ms. Da el dia y desempata los movimientos de ese dia. */
  at: number;
  type: TxType;
  /** El activo, como lo llama Binance. Se resuelve al guardar. */
  symbol?: string;
  quantity?: number;
  price?: number;
  amount: number;
  currency: Currency;
  fee?: number;
  toAmount?: number;
  toCurrency?: Currency;
  fxRate?: number;
  note: string;
}

export interface Group {
  drafts: Draft[];
}

/** `null`: no hay nada que registrar (dolar estable contra dolar estable, algo pendiente). */
export type Mapped = Group | { skip: string } | null;

/** El precio en dolares de un activo en un momento, o null si Binance no lo tiene. */
export type UsdPrice = (asset: string, at: number) => Promise<number | null>;

interface Leg {
  asset: string;
  amount: number;
}

/** Monedas de curso legal que Waltra no lleva: un movimiento en euros no tiene donde caer. */
const OTRAS_MONEDAS = new Set([
  "EUR", "GBP", "TRY", "BRL", "AUD", "RUB", "UAH", "NGN", "ZAR", "PLN", "RON", "MXN", "COP",
  "JPY", "KZT", "CZK", "IDR", "VND", "PHP", "PEN", "CLP", "INR", "CAD", "CHF", "SEK", "NOK",
  "DKK", "HUF", "AED", "SAR", "EGP", "KES", "GHS", "BGN", "HKD", "TWD", "THB", "PKR", "BDT",
  "MYR", "NZD", "SGD", "UGX", "VES", "BOB", "PYG", "UYU", "GEL", "AZN", "MAD", "XOF",
]);

type Side = { kind: "cash"; currency: Currency } | { kind: "crypto" } | { kind: "other" };

export function sideOf(asset: string): Side {
  if (DOLARES.includes(asset)) return { kind: "cash", currency: "USD" };
  if (asset === "ARS") return { kind: "cash", currency: "ARS" };
  if (OTRAS_MONEDAS.has(asset)) return { kind: "other" };
  return { kind: "crypto" };
}

/** Sin los restos de la coma flotante: 0,00999 y no 0,009990000000000001. */
const clean = (n: number) => Number(n.toPrecision(12));

function tidy(d: Draft): Draft {
  const out: Draft = { ...d, amount: clean(d.amount) };
  for (const k of ["quantity", "price", "fee", "toAmount", "fxRate"] as const) {
    const v = d[k];
    if (v === undefined) continue;
    if (k === "fee" && !(v > 0)) delete out[k];
    else out[k] = clean(v);
  }
  return out;
}

const fmt = (n: number) => String(clean(n));

/** Los pesos que se pagaron por cada dolar, si el cambio fue entre pesos y dolares. */
function rate(a: { amount: number; currency: Currency }, b: { amount: number; currency: Currency }) {
  if (a.currency === "ARS" && b.currency === "USD" && b.amount > 0) return a.amount / b.amount;
  if (a.currency === "USD" && b.currency === "ARS" && a.amount > 0) return b.amount / a.amount;
  return undefined;
}

/**
 * Un intercambio: sale `from`, entra `to`. Es el caso general de una orden
 * spot, un Convert, una compra P2P o con tarjeta. Devuelve los movimientos, o
 * el motivo por el que no se puede registrar.
 */
export async function swap(
  base: { id: string; at: number; note: string },
  from: Leg,
  to: Leg,
  fees: Leg[],
  usd: UsdPrice,
): Promise<Draft[] | string> {
  const { id, at, note } = base;
  const f = sideOf(from.asset);
  const t = sideOf(to.asset);
  if (f.kind === "other") return `${from.asset} → ${to.asset}: Waltra no lleva ${from.asset}.`;
  if (t.kind === "other") return `${from.asset} → ${to.asset}: Waltra no lleva ${to.asset}.`;
  if (!(from.amount > 0) || !(to.amount > 0)) return `${from.asset} → ${to.asset}: sin montos.`;

  const out: Draft[] = [];
  const sueltas: Leg[] = [];

  if (f.kind === "cash" && t.kind === "cash" && f.currency === t.currency) {
    // Un dolar estable por otro no mueve nada que Waltra lleve, salvo la
    // comision si se pago en BNB: esa si son unidades que se fueron.
    for (const c of fees) if (sideOf(c.asset).kind !== "cash") sueltas.push(c);
  } else if (f.kind === "cash" && t.kind === "cash") {
    let toAmount = to.amount;
    let fee = 0;
    for (const c of fees) {
      const s = sideOf(c.asset);
      if (s.kind === "cash" && s.currency === t.currency) toAmount -= c.amount;
      else if (s.kind === "cash" && s.currency === f.currency) fee += c.amount;
      else sueltas.push(c);
    }
    const sale = { amount: from.amount, currency: f.currency };
    const entra = { amount: toAmount, currency: t.currency };
    out.push({
      id, at, type: "exchange", note,
      amount: sale.amount, currency: sale.currency,
      toAmount: entra.amount, toCurrency: entra.currency,
      fee, fxRate: rate(sale, entra),
    });
  } else if (f.kind === "cash") {
    // Compra con efectivo. La comision cobrada en lo comprado son unidades
    // que no llegaron: salen de la cantidad y se anotan como comision, asi
    // lo pagado sigue siendo lo que salio de la cuenta.
    const price = from.amount / to.amount;
    let quantity = to.amount;
    let amount = from.amount;
    let fee = 0;
    for (const c of fees) {
      const s = sideOf(c.asset);
      if (c.asset === to.asset) {
        quantity -= c.amount;
        amount -= c.amount * price;
        fee += c.amount * price;
      } else if (s.kind === "cash" && s.currency === f.currency) fee += c.amount;
      else sueltas.push(c);
    }
    out.push({ id, at, type: "buy", note, symbol: to.asset, quantity, price, amount, currency: f.currency, fee });
  } else if (t.kind === "cash") {
    // Venta por efectivo. Si la comision se cobro en lo vendido, se fueron
    // unidades de mas por el mismo precio.
    const price = to.amount / from.amount;
    let quantity = from.amount;
    let amount = to.amount;
    let fee = 0;
    for (const c of fees) {
      const s = sideOf(c.asset);
      if (c.asset === from.asset) {
        quantity += c.amount;
        amount += c.amount * price;
        fee += c.amount * price;
      } else if (s.kind === "cash" && s.currency === t.currency) fee += c.amount;
      else sueltas.push(c);
    }
    out.push({ id, at, type: "sell", note, symbol: from.asset, quantity, price, amount, currency: t.currency, fee });
  } else {
    // Cripto contra cripto: una venta y una compra por lo mismo, en dolares
    // de ese momento.
    const pFrom = await usd(from.asset, at);
    const pTo = pFrom ? null : await usd(to.asset, at);
    const value = pFrom ? from.amount * pFrom : pTo ? to.amount * pTo : null;
    if (!value) return `${from.asset} → ${to.asset}: no encontré el precio en dólares de ese momento.`;
    const sellPrice = value / from.amount;
    const buyPrice = value / to.amount;
    const venta = { quantity: from.amount, amount: value, fee: 0 };
    const compra = { quantity: to.amount, amount: value, fee: 0 };
    for (const c of fees) {
      const s = sideOf(c.asset);
      if (c.asset === to.asset) {
        compra.quantity -= c.amount;
        compra.amount -= c.amount * buyPrice;
        compra.fee += c.amount * buyPrice;
      } else if (c.asset === from.asset) {
        venta.quantity += c.amount;
        venta.amount += c.amount * sellPrice;
        venta.fee += c.amount * sellPrice;
      } else if (s.kind === "cash" && s.currency === "USD") compra.fee += c.amount;
      else sueltas.push(c);
    }
    out.push(
      { id: `${id}-v`, at, type: "sell", note, symbol: from.asset, price: sellPrice, currency: "USD", ...venta },
      { id, at: at + 1, type: "buy", note, symbol: to.asset, price: buyPrice, currency: "USD", ...compra },
    );
  }

  // Comisiones en un tercero: casi siempre BNB.
  for (const c of sueltas) {
    if (!(c.amount > 0)) continue;
    const s = sideOf(c.asset);
    const cid = `${id}-com-${c.asset}`;
    if (s.kind === "cash") {
      out.push({ id: cid, at: at + 2, type: "fee", amount: c.amount, currency: s.currency, note: `Comisión en ${c.asset}` });
    } else if (s.kind === "crypto") {
      const p = await usd(c.asset, at);
      out.push({
        id: cid, at: at + 2, type: "adjust", symbol: c.asset, quantity: -c.amount,
        amount: p ? c.amount * p : 0, currency: "USD", note: `Comisión en ${c.asset}`,
      });
    }
  }
  return out.map(tidy);
}

// ---------------------------------------------------------------------------
// Ordenes spot

export interface Order {
  orderId: number;
  base: string;
  quote: string;
  isBuyer: boolean;
  qty: number;
  quoteQty: number;
  fees: Leg[];
  /** La ultima ejecucion: cuando quedo hecha. */
  at: number;
}

/** Junta las ejecuciones de cada orden: Waltra guarda una orden, no cada pedazo. */
export function ordersFromFills(base: string, quote: string, fs: Fill[]): Order[] {
  const byOrder = new Map<number, Order>();
  for (const f of fs) {
    let o = byOrder.get(f.orderId);
    if (!o) {
      o = { orderId: f.orderId, base, quote, isBuyer: f.isBuyer, qty: 0, quoteQty: 0, fees: [], at: 0 };
      byOrder.set(f.orderId, o);
    }
    o.qty += f.qty;
    o.quoteQty += f.quoteQty;
    o.at = Math.max(o.at, f.time);
    if (f.commission > 0) {
      const leg = o.fees.find((l) => l.asset === f.commissionAsset);
      if (leg) leg.amount += f.commission;
      else o.fees.push({ asset: f.commissionAsset, amount: f.commission });
    }
  }
  return [...byOrder.values()].sort((a, b) => a.at - b.at);
}

export const orderId = (o: { orderId: number }) => `binance-${o.orderId}`;

export async function orderGroup(o: Order, usd: UsdPrice): Promise<Mapped> {
  const base = { asset: o.base, amount: o.qty };
  const quote = { asset: o.quote, amount: o.quoteQty };
  const drafts = await swap(
    { id: orderId(o), at: o.at, note: `Binance ${o.base}/${o.quote}` },
    o.isBuyer ? quote : base,
    o.isBuyer ? base : quote,
    o.fees,
    usd,
  );
  if (typeof drafts === "string") return { skip: drafts };
  return drafts.length ? { drafts } : null;
}

// ---------------------------------------------------------------------------
// Convert

export async function convertGroup(c: Convert, usd: UsdPrice): Promise<Mapped> {
  if (c.status !== "SUCCESS") return null;
  const drafts = await swap(
    { id: `binance-cv-${c.orderId}`, at: c.time, note: `Convert ${c.from} → ${c.to}` },
    { asset: c.from, amount: c.fromAmount },
    { asset: c.to, amount: c.toAmount },
    [],
    usd,
  );
  if (typeof drafts === "string") return { skip: drafts };
  return drafts.length ? { drafts } : null;
}

// ---------------------------------------------------------------------------
// Ingresos y retiros de cripto

export async function depositGroup(d: Deposit, usd: UsdPrice): Promise<Mapped> {
  if (d.status !== 1 && d.status !== 6) return null;
  const id = `binance-ing-${d.id}`;
  const s = sideOf(d.coin);
  if (s.kind === "other") return { skip: `Ingreso de ${d.coin}: Waltra no lleva esa moneda.` };
  if (s.kind === "cash") {
    return { drafts: [tidy({ id, at: d.time, type: "deposit", amount: d.amount, currency: s.currency, note: `Ingreso de ${d.coin}` })] };
  }
  const p = await usd(d.coin, d.time);
  if (!p) return { skip: `Ingreso de ${fmt(d.amount)} ${d.coin}: no encontré su precio en dólares.` };
  const nota = `Llegaron ${fmt(d.amount)} ${d.coin} de otra billetera`;
  return {
    drafts: [
      tidy({ id, at: d.time, type: "deposit", amount: d.amount * p, currency: "USD", note: nota }),
      tidy({ id: `${id}-c`, at: d.time + 1, type: "buy", symbol: d.coin, quantity: d.amount, price: p, amount: d.amount * p, currency: "USD", note: nota }),
    ],
  };
}

export async function withdrawalGroup(w: Withdrawal, usd: UsdPrice): Promise<Mapped> {
  if (w.status !== 6) return null;
  const id = `binance-ret-${w.id}`;
  const s = sideOf(w.coin);
  if (s.kind === "other") return { skip: `Retiro de ${w.coin}: Waltra no lleva esa moneda.` };
  if (s.kind === "cash") {
    return {
      drafts: [tidy({ id, at: w.time, type: "withdraw", amount: w.amount, fee: w.fee, currency: s.currency, note: `Retiro de ${w.coin}` })],
    };
  }
  const p = await usd(w.coin, w.time);
  if (!p) return { skip: `Retiro de ${fmt(w.amount)} ${w.coin}: no encontré su precio en dólares.` };
  const nota = `Salieron ${fmt(w.amount)} ${w.coin} a otra billetera`;
  return {
    drafts: [
      tidy({
        id: `${id}-v`, at: w.time, type: "sell", symbol: w.coin, quantity: w.amount + w.fee, price: p,
        amount: (w.amount + w.fee) * p, currency: "USD", note: nota,
      }),
      tidy({ id, at: w.time + 1, type: "withdraw", amount: w.amount * p, fee: w.fee * p, currency: "USD", note: nota }),
    ],
  };
}

// ---------------------------------------------------------------------------
// P2P y moneda local

export async function p2pGroup(o: P2POrder, usd: UsdPrice): Promise<Mapped> {
  if (o.status !== "COMPLETED") return null;
  const fiat = sideOf(o.fiat);
  if (fiat.kind !== "cash") return { skip: `P2P en ${o.fiat}: Waltra lleva pesos y dólares.` };
  const id = `binance-p2p-${o.orderNumber}`;
  const fees = o.fee > 0 ? [{ asset: o.asset, amount: o.fee }] : [];
  if (o.side === "BUY") {
    // Entraron pesos de afuera (capital) y se cambiaron en el momento.
    const legs = await swap(
      { id: `${id}-c`, at: o.time + 1, note: `P2P: compra de ${o.asset}` },
      { asset: o.fiat, amount: o.total },
      { asset: o.asset, amount: o.amount },
      fees,
      usd,
    );
    if (typeof legs === "string") return { skip: legs };
    return {
      drafts: [tidy({ id, at: o.time, type: "deposit", amount: o.total, currency: fiat.currency, note: `P2P: pago por ${fmt(o.amount)} ${o.asset}` }), ...legs],
    };
  }
  const legs = await swap(
    { id: `${id}-c`, at: o.time, note: `P2P: venta de ${o.asset}` },
    { asset: o.asset, amount: o.amount },
    { asset: o.fiat, amount: o.total },
    fees,
    usd,
  );
  if (typeof legs === "string") return { skip: legs };
  return {
    drafts: [...legs, tidy({ id, at: o.time + 3, type: "withdraw", amount: o.total, currency: fiat.currency, note: `P2P: cobro por ${fmt(o.amount)} ${o.asset}` })],
  };
}

const exitoso = (status: string) => /^(success|successful|completed|finished)$/i.test(status);

export function fiatGroup(o: FiatOrder): Mapped {
  if (!exitoso(o.status)) return null;
  const s = sideOf(o.fiat);
  if (s.kind !== "cash") return { skip: `${o.kind === "deposit" ? "Ingreso" : "Retiro"} en ${o.fiat}: Waltra lleva pesos y dólares.` };
  const id = `binance-fiat-${o.orderNo}`;
  if (o.kind === "deposit") {
    return { drafts: [tidy({ id, at: o.time, type: "deposit", amount: o.amount, fee: o.fee, currency: s.currency, note: `Ingreso de ${o.fiat}` })] };
  }
  return {
    drafts: [tidy({ id, at: o.time, type: "withdraw", amount: Math.max(0, o.amount - o.fee), fee: o.fee, currency: s.currency, note: `Retiro de ${o.fiat}` })],
  };
}

export async function paymentGroup(p: FiatPayment, usd: UsdPrice): Promise<Mapped> {
  if (!exitoso(p.status)) return null;
  const s = sideOf(p.fiat);
  if (s.kind !== "cash") return { skip: `Compra con tarjeta en ${p.fiat}: Waltra lleva pesos y dólares.` };
  const id = `binance-pago-${p.orderNo}`;
  const legs = await swap(
    { id: `${id}-c`, at: p.time + 1, note: `Compra de ${p.crypto} con tarjeta` },
    { asset: p.fiat, amount: p.paid },
    { asset: p.crypto, amount: p.obtained },
    [],
    usd,
  );
  if (typeof legs === "string") return { skip: legs };
  return {
    drafts: [tidy({ id, at: p.time, type: "deposit", amount: p.paid, currency: s.currency, note: `Pago con tarjeta por ${fmt(p.obtained)} ${p.crypto}` }), ...legs],
  };
}

// ---------------------------------------------------------------------------
// Earn

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/**
 * Lo que pago Earn en un mes, en un solo movimiento por activo.
 *
 * Binance paga todos los dias; un movimiento por dia taparia todo lo demas en
 * la lista. Se carga una vez, cuando el mes termino: un movimiento que ya
 * esta no se rearma. En dolares estables es un interes cobrado; en una
 * cripto, unidades que entran al precio de cada dia como ingreso (un ajuste,
 * como Corregir).
 */
export function earnGroup(asset: string, month: string, total: { units: number; value: number; last: number }): Mapped {
  const s = sideOf(asset);
  if (s.kind === "other") return { skip: `Earn en ${asset}: Waltra no lleva esa moneda.` };
  const [y, m] = month.split("-").map(Number);
  const note = `Earn de ${asset}, ${MESES[m - 1]} de ${y}`;
  const id = `binance-earn-${asset}-${month}`;
  if (s.kind === "cash") {
    return { drafts: [tidy({ id, at: total.last, type: "interest", amount: total.units, currency: s.currency, note })] };
  }
  if (!(total.value > 0)) return { skip: `Earn en ${asset}: no encontré su precio en dólares.` };
  return {
    drafts: [tidy({ id, at: total.last, type: "adjust", symbol: asset, quantity: total.units, amount: total.value, currency: "USD", note })],
  };
}
