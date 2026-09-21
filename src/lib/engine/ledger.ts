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

/** Ordena cronologicamente y, a igualdad de fecha, respeta el orden de carga. */
export function sortTransactions(txs: Transaction[]): Transaction[] {
  return [...txs].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
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
      const lot = (state.positions[tx.assetId] ??= { quantity: 0, avgCost: 0, avgCostUsd: 0 });
      const costLocal = lot.avgCost * lot.quantity + tx.amount + fee;
      const costUsd = lot.avgCostUsd * lot.quantity + usd(tx.amount + fee);
      lot.quantity += tx.quantity;
      lot.avgCost = lot.quantity > 0 ? costLocal / lot.quantity : 0;
      lot.avgCostUsd = lot.quantity > 0 ? costUsd / lot.quantity : 0;
      bumpPosition(state, tx.accountId, tx.assetId, tx.quantity);
      state.feesUsd += usd(fee);
      break;
    }
    case "sell": {
      if (!tx.assetId || !tx.quantity) break;
      bumpCash(state.cash, tx.accountId, tx.currency, tx.amount - fee);
      const lot = (state.positions[tx.assetId] ??= { quantity: 0, avgCost: 0, avgCostUsd: 0 });
      const sold = Math.min(tx.quantity, Math.max(lot.quantity, 0)) || tx.quantity;
      const proceedsUsd = usd(tx.amount - fee);
      const basisUsd = lot.avgCostUsd * sold;
      const pnl = proceedsUsd - basisUsd;
      state.realizedUsd += pnl;
      state.realizedByAsset[tx.assetId] = (state.realizedByAsset[tx.assetId] ?? 0) + pnl;
      lot.quantity -= tx.quantity;
      if (lot.quantity <= 1e-12) {
        lot.quantity = 0;
        lot.avgCost = 0;
        lot.avgCostUsd = 0;
      }
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
  }
  void assets;
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
