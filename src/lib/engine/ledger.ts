import type { Asset, Currency, Transaction } from "@/lib/types";
import type { DayKey } from "@/lib/date";
import { toDay } from "@/lib/date";
import { FxTable, toUsd } from "./fx";

/** Efectivo por cuenta y moneda. */
export type CashBook = Record<string, Partial<Record<Currency, number>>>;

export interface Lot {
  quantity: number;
  /** Costo promedio por unidad, en la moneda del activo. */
  avgCost: number;
  /** Costo promedio por unidad convertido a USD al momento de cada compra. */
  avgCostUsd: number;
}

export interface LedgerState {
  /** assetId -> posicion acumulada. */
  positions: Record<string, Lot>;
  /** Posiciones abiertas por cuenta: accountId -> assetId -> cantidad. */
  byAccount: Record<string, Record<string, number>>;
  cash: CashBook;
  /** Resultado realizado acumulado, en USD. */
  realizedUsd: number;
  /** Realizado por activo, en USD. */
  realizedByAsset: Record<string, number>;
  /** Dividendos + intereses cobrados, en USD. */
  incomeUsd: number;
  /** Comisiones pagadas, en USD. */
  feesUsd: number;
  /** Capital neto aportado (deposit - withdraw), en USD. */
  netContributedUsd: number;
  depositedUsd: number;
  withdrawnUsd: number;
}

export function emptyLedger(): LedgerState {
  return {
    positions: {},
    byAccount: {},
    cash: {},
    realizedUsd: 0,
    realizedByAsset: {},
    incomeUsd: 0,
    feesUsd: 0,
    netContributedUsd: 0,
    depositedUsd: 0,
    withdrawnUsd: 0,
  };
}

function bumpCash(book: CashBook, accountId: string, currency: Currency, delta: number) {
  const acc = (book[accountId] ??= {});
  acc[currency] = (acc[currency] ?? 0) + delta;
}

function bumpPosition(state: LedgerState, accountId: string, assetId: string, delta: number) {
  const acc = (state.byAccount[accountId] ??= {});
  acc[assetId] = (acc[assetId] ?? 0) + delta;
  if (Math.abs(acc[assetId]) < 1e-12) delete acc[assetId];
}

/**
 * Suma unidades a una posicion con su costo.
 *
 * Si la posicion estaba en negativo (se vendio mas de lo que figura comprado,
 * casi siempre porque falta un deposito del activo), las primeras unidades la
 * cubren. Esas se habian vendido sin costo conocido, asi que su resultado se
 * habia contado entero; ahora que se sabe lo que cuesta reponerlas, ese costo
 * sale del realizado. Lo que sobra forma la posicion con su costo.
 *
 * Antes la posicion se pisaba en cero al quedar negativa y la cuenta no: la
 * cartera y el detalle de la cuenta terminaban mostrando unidades distintas
 * del mismo activo.
 */
function addUnits(
  state: LedgerState,
  assetId: string,
  quantity: number,
  costLocal: number,
  costUsd: number,
): void {
  const lot = (state.positions[assetId] ??= { quantity: 0, avgCost: 0, avgCostUsd: 0 });
  let q = quantity;
  if (lot.quantity < 0 && q > 0) {
    const cubre = Math.min(q, -lot.quantity);
    const parte = cubre / q;
    state.realizedUsd -= costUsd * parte;
    state.realizedByAsset[assetId] = (state.realizedByAsset[assetId] ?? 0) - costUsd * parte;
    lot.quantity += cubre;
    if (Math.abs(lot.quantity) < 1e-12) lot.quantity = 0;
    costLocal *= 1 - parte;
    costUsd *= 1 - parte;
    q -= cubre;
  }
  if (q <= 0) return;
  const totalLocal = lot.avgCost * lot.quantity + costLocal;
  const totalUsd = lot.avgCostUsd * lot.quantity + costUsd;
  lot.quantity += q;
  lot.avgCost = totalLocal / lot.quantity;
  lot.avgCostUsd = totalUsd / lot.quantity;
}

/**
 * Saca unidades de una posicion. Puede quedar en negativo: la cuenta tambien
 * queda asi, y las dos tienen que decir lo mismo. Devuelve cuantas de las
 * que salieron tenian costo conocido.
 */
function removeUnits(state: LedgerState, assetId: string, quantity: number): number {
  const lot = (state.positions[assetId] ??= { quantity: 0, avgCost: 0, avgCostUsd: 0 });
  const conCosto = Math.min(quantity, Math.max(lot.quantity, 0));
  lot.quantity -= quantity;
  if (lot.quantity <= 1e-12) {
    if (Math.abs(lot.quantity) < 1e-12) lot.quantity = 0;
    lot.avgCost = 0;
    lot.avgCostUsd = 0;
  }
  return conCosto;
}

/**
 * Ordena cronologicamente y, a igualdad de fecha, respeta el orden de carga.
 *
 * Salvo los cambios de ratio, que van primero en su dia: rigen desde que abre
 * el mercado. Una compra de ese mismo dia ya se hizo en unidades nuevas, y si
 * el split se cargo despues que ella la multiplicaria.
 */
export function sortTransactions(txs: Transaction[]): Transaction[] {
  return [...txs].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const sa = a.type === "split" ? 0 : 1;
    const sb = b.type === "split" ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}

/**
 * Aplica una transaccion al estado. Muta `state` a proposito: el recorrido
 * diario de la serie historica reaplica miles de movimientos y copiar el estado
 * en cada paso es gasto puro.
 */
export function applyTransaction(
  state: LedgerState,
  tx: Transaction,
  assets: Record<string, Asset>,
  fx: FxTable,
): void {
  const day = toDay(tx.date);
  const rate = tx.fxRate && tx.fxRate > 0 ? tx.fxRate : fx.at(day);
  const usd = (v: number) => toUsd(v, tx.currency, rate);
  const fee = tx.fee ?? 0;
  /**
   * Un monto de la operacion, en la moneda del activo.
   *
   * Casi siempre son la misma, pero un CEDEAR cotiza en pesos y desde Cocos se
   * compra en dolares. El costo promedio se guarda en la moneda del activo
   * porque es contra su precio que se compara (y con lo que se valua si falta
   * la cotizacion): sumar dolares a un costo en pesos daria un CEDEAR que
   * "costo $ 33". Se convierte al dolar de la operacion, o al del dia.
   */
  const asset = tx.assetId ? assets[tx.assetId] : undefined;
  const local = (v: number): number => {
    if (!asset || asset.currency === tx.currency) return v;
    return asset.currency === "USD" ? usd(v) : usd(v) * rate;
  };

  switch (tx.type) {
    case "deposit": {
      bumpCash(state.cash, tx.accountId, tx.currency, tx.amount - fee);
      state.depositedUsd += usd(tx.amount);
      state.netContributedUsd += usd(tx.amount);
      state.feesUsd += usd(fee);
      break;
    }
    case "withdraw": {
      bumpCash(state.cash, tx.accountId, tx.currency, -(tx.amount + fee));
      state.withdrawnUsd += usd(tx.amount);
      state.netContributedUsd -= usd(tx.amount);
      state.feesUsd += usd(fee);
      break;
    }
    case "transfer": {
      bumpCash(state.cash, tx.accountId, tx.currency, -(tx.amount + fee));
      if (tx.counterAccountId) {
        bumpCash(state.cash, tx.counterAccountId, tx.currency, tx.amount);
      }
      state.feesUsd += usd(fee);
      break;
    }
    case "buy": {
      if (!tx.assetId || !tx.quantity) break;
      bumpCash(state.cash, tx.accountId, tx.currency, -(tx.amount + fee));
      addUnits(state, tx.assetId, tx.quantity, local(tx.amount + fee), usd(tx.amount + fee));
      bumpPosition(state, tx.accountId, tx.assetId, tx.quantity);
      state.feesUsd += usd(fee);
      break;
    }
    case "sell": {
      if (!tx.assetId || !tx.quantity) break;
      bumpCash(state.cash, tx.accountId, tx.currency, tx.amount - fee);
      const costoUnidad = state.positions[tx.assetId]?.avgCostUsd ?? 0;
      // Lo vendido de mas no tiene costo conocido: su resultado se corrige
      // cuando una compra posterior lo cubre (ver `addUnits`).
      const conCosto = removeUnits(state, tx.assetId, tx.quantity);
      const pnl = usd(tx.amount - fee) - costoUnidad * conCosto;
      state.realizedUsd += pnl;
      state.realizedByAsset[tx.assetId] = (state.realizedByAsset[tx.assetId] ?? 0) + pnl;
      bumpPosition(state, tx.accountId, tx.assetId, -tx.quantity);
      state.feesUsd += usd(fee);
      break;
    }
    case "dividend":
    case "interest": {
      bumpCash(state.cash, tx.accountId, tx.currency, tx.amount - fee);
      state.incomeUsd += usd(tx.amount);
      state.feesUsd += usd(fee);
      if (tx.assetId) {
        state.realizedByAsset[tx.assetId] =
          (state.realizedByAsset[tx.assetId] ?? 0) + usd(tx.amount);
      }
      break;
    }
    case "fee": {
      bumpCash(state.cash, tx.accountId, tx.currency, -tx.amount);
      state.feesUsd += usd(tx.amount);
      break;
    }
    case "split": {
      // Cada unidad pasa a ser `ratio` unidades. La plata no se mueve: el
      // costo total queda igual, repartido en mas unidades. Tampoco hay
      // resultado realizado: no se vendio nada.
      if (!tx.assetId || !tx.ratio || tx.ratio <= 0) break;
      const r = tx.ratio;
      const lot = state.positions[tx.assetId];
      if (lot) {
        lot.quantity *= r;
        lot.avgCost /= r;
        lot.avgCostUsd /= r;
      }
      for (const held of Object.values(state.byAccount)) {
        if (held[tx.assetId]) held[tx.assetId] *= r;
      }
      break;
    }
    case "adjust": {
      // Lo que el broker tiene y los movimientos no explican. No toca el
      // efectivo ni el capital: la plata no cruzo el borde del portafolio.
      if (!tx.assetId || !tx.quantity) break;
      if (tx.quantity > 0) {
        // De mas, como un rendimiento cobrado en el activo: entra al precio
        // del dia, asi que su costo es ese mismo valor y no aparece como
        // ganancia sin realizar de un saque. Lo que vale es ingreso.
        addUnits(state, tx.assetId, tx.quantity, local(tx.amount), usd(tx.amount));
        state.incomeUsd += usd(tx.amount);
        state.realizedByAsset[tx.assetId] =
          (state.realizedByAsset[tx.assetId] ?? 0) + usd(tx.amount);
      } else {
        // De menos, como una comision cobrada en el activo: salen al costo
        // promedio. Lo que habian subido se va con ellas de la ganancia sin
        // realizar, sin pasar por el realizado: no se vendio nada.
        const costoUnidad = state.positions[tx.assetId]?.avgCostUsd ?? 0;
        state.feesUsd += costoUnidad * removeUnits(state, tx.assetId, -tx.quantity);
      }
      bumpPosition(state, tx.accountId, tx.assetId, tx.quantity);
      break;
    }
    case "exchange": {
      // Salen pesos y entran dolares (o al reves) en la misma cuenta. No toca
      // el capital: la plata no cruzo el borde del portafolio, cambio de forma.
      // Cada lado se valua despues al dolar del dia, asi que si se pago mas
      // caro que ese dolar el patrimonio baja un poco, y esa es la verdad.
      if (!tx.toCurrency || !tx.toAmount) break;
      bumpCash(state.cash, tx.accountId, tx.currency, -(tx.amount + fee));
      bumpCash(state.cash, tx.accountId, tx.toCurrency, tx.toAmount);
      state.feesUsd += usd(fee);
      break;
    }
  }
}

/** Flujo de capital externo del dia, en USD (positivo = entra plata nueva). */
export function externalFlowUsd(tx: Transaction, fx: FxTable): number {
  const rate = tx.fxRate && tx.fxRate > 0 ? tx.fxRate : fx.at(toDay(tx.date));
  if (tx.type === "deposit") return toUsd(tx.amount, tx.currency, rate);
  if (tx.type === "withdraw") return -toUsd(tx.amount, tx.currency, rate);
  return 0;
}

export function buildLedger(
  txs: Transaction[],
  assets: Record<string, Asset>,
  fx: FxTable,
  until?: DayKey,
): LedgerState {
  const state = emptyLedger();
  for (const tx of sortTransactions(txs)) {
    if (until && toDay(tx.date) > until) break;
    applyTransaction(state, tx, assets, fx);
  }
  return state;
}
