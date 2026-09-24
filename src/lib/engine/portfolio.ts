import type { Account, Asset, Currency, FxRate, PriceSeries, Quote, Transaction } from "@/lib/types";
import type { DayKey } from "@/lib/date";
import { addDays, daysBetween, maxDay, toDay, today } from "@/lib/date";
import { FxTable, toUsd } from "./fx";
import { PriceLookup } from "./prices";
import {
  collectSplits,
  priceFactor,
  providerSplitTransactions,
  unitsFactor,
  type AssetSplit,
} from "./splits";
import {
  applyTransaction,
  emptyLedger,
  externalFlowUsd,
  sortTransactions,
  type LedgerState,
} from "./ledger";
import {
  annualize,
  maxDrawdown,
  timeWeightedReturn,
  volatility,
  xirr,
  type CashFlow,
  type DailyPoint,
  type TwrPoint,
} from "./returns";

/**
 * Una compra o una venta, en dolares del dia en que paso.
 *
 * Es la historia que hace falta para analizar una posicion y no solo mirarla:
 * cuando entro, a que precio, si promedio a la baja o persiguio la suba. Cada
 * operacion se pasa a dolares con el dolar que se uso en ella, o el del dia,
 * igual que en el costo: asi el precio de una compra en pesos se puede
 * comparar con el de hoy.
 */
export interface TradeView {
  day: DayKey;
  side: "buy" | "sell";
  /**
   * Cantidad y precio en unidades de hoy: si despues hubo un split de 2,5,
   * 9 CEDEARs a US$ 35 figuran como 22,5 a US$ 14. Es la unica forma de
   * comparar una compra vieja con el precio actual sin inventar una caida.
   */
  quantity: number;
  /** Precio por unidad en dolares. `null` si era en pesos y no habia dolar. */
  priceUsd: number | null;
  amountUsd: number | null;
  /** Por cuanto se multiplicaron las unidades por splits posteriores. 1 si ninguno. */
  unitsFactor: number;
}

/**
 * Compras que no cierran con la cotizacion historica de ese dia.
 *
 * Casi siempre es un cambio de ratio que la app no conoce: el proveedor da los
 * precios viejos ya ajustados y la compra quedo en la escala anterior. Tambien
 * puede ser un precio mal cargado. En los dos casos la app lo dice en vez de
 * mostrar una ganancia o una perdida que no existen.
 */
export interface PriceMismatch {
  assetId: string;
  symbol: string;
  /** Una compra de ejemplo, la mas representativa. */
  day: DayKey;
  /** Lo que se pago por unidad y lo que cotizaba ese dia, en la moneda del activo. */
  paid: number;
  market: number;
  currency: Currency;
  /** Pagado sobre cotizado, mediana de las compras del activo. */
  factor: number;
}

/** Una posicion que ya se vendio entera: lo que dejo, y como se opero. */
export interface ClosedPositionView {
  assetId: string;
  symbol: string;
  name: string;
  kind: Asset["kind"];
  realizedUsd: number;
  trades: TradeView[];
}

export interface PositionView {
  assetId: string;
  symbol: string;
  name: string;
  kind: Asset["kind"];
  currency: Currency;
  quantity: number;
  /** Precio actual en la moneda del activo. */
  price: number | null;
  priceUsd: number | null;
  avgCost: number;
  avgCostUsd: number;
  costUsd: number;
  valueUsd: number;
  unrealizedUsd: number;
  unrealizedPct: number | null;
  realizedUsd: number;
  totalPnlUsd: number;
  /** Peso sobre el total invertido (sin contar efectivo). */
  weight: number;
  dayChangePct?: number;
  accounts: { accountId: string; quantity: number }[];
  priceMissing: boolean;
  /** Compras y ventas de este activo, de la mas vieja a la mas nueva. */
  trades: TradeView[];
}

export interface AccountView {
  accountId: string;
  name: string;
  broker: Account["broker"];
  cash: Partial<Record<Currency, number>>;
  cashUsd: number;
  investedUsd: number;
  valueUsd: number;
  netContributedUsd: number;
  pnlUsd: number;
  pnlPct: number | null;
  weight: number;
}

export interface PortfolioMetrics {
  twrCumulative: number | null;
  twrAnnualized: number | null;
  xirr: number | null;
  volatility: number | null;
  maxDrawdown: { value: number; from?: DayKey; to?: DayKey };
  /** Dias desde el primer movimiento. */
  ageDays: number;
}

export interface Portfolio {
  asOf: DayKey;
  hasData: boolean;
  firstDay: DayKey | null;
  totalValueUsd: number;
  cashUsd: number;
  investedUsd: number;
  netContributedUsd: number;
  depositedUsd: number;
  withdrawnUsd: number;
  unrealizedUsd: number;
  realizedUsd: number;
  incomeUsd: number;
  feesUsd: number;
  /** Ganancia total = valor actual - capital neto aportado. */
  totalPnlUsd: number;
  /** Ganancia simple sobre el capital aportado. */
  simpleReturn: number | null;
  positions: PositionView[];
  /** Lo que se tuvo y se vendio entero. Sin esto, el analisis solo ve a los que quedaron. */
  closedPositions: ClosedPositionView[];
  /** Splits de cada activo, manuales y del proveedor. Ver `engine/splits.ts`. */
  splits: Record<string, AssetSplit[]>;
  /** Activos cuyas compras no cierran con su cotizacion historica. */
  priceMismatches: PriceMismatch[];
  accountViews: AccountView[];
  daily: DailyPoint[];
  contributions: { day: DayKey; value: number }[];
  twr: TwrPoint[];
  metrics: PortfolioMetrics;
  fxLatest: number;
  /** Activos sin cotizacion disponible: la UI avisa en vez de mentir. */
  missingPrices: string[];
  /**
   * Hay exposicion en pesos pero no se pudo traer el dolar MEP, asi que esos
   * montos no estan contados en los totales.
   */
  fxMissing: boolean;
}

export interface PortfolioInput {
  transactions: Transaction[];
  assets: Asset[];
  accounts: Account[];
  priceSeries: PriceSeries[];
  quotes: Quote[];
  fxRates: FxRate[];
  asOf?: DayKey;
}

/** Valor de mercado del estado del ledger en un dia dado, en USD. */
function valueAt(
  state: LedgerState,
  day: DayKey,
  assetsById: Record<string, Asset>,
  prices: PriceLookup,
  fx: FxTable,
  splits: Record<string, AssetSplit[]> = {},
): { nav: number; invested: number; cash: number } {
  const rate = fx.at(day);
  let invested = 0;
  for (const [assetId, lot] of Object.entries(state.positions)) {
    if (lot.quantity <= 1e-12) continue;
    const asset = assetsById[assetId];
    if (!asset) continue;
    // La serie puede venir ajustada por splits posteriores (Yahoo divide los
    // cierres viejos por el ratio). Se deshace el ajuste para tener el precio
    // de ese dia, que es el que corresponde a las unidades de ese dia.
    const serie = prices.at(assetId, day);
    const close =
      serie !== null && serie !== undefined
        ? serie * priceFactor(splits[assetId], day)
        : (asset.manualPrice ?? null);
    // Sin precio, valuamos al costo: subestimar es mejor que inventar.
    const unit = close ?? lot.avgCost;
    invested += toUsd(unit * lot.quantity, asset.currency, rate);
  }
  let cash = 0;
  for (const acc of Object.values(state.cash)) {
    for (const [cur, amount] of Object.entries(acc)) {
      cash += toUsd(amount ?? 0, cur as Currency, rate);
    }
  }
  return { nav: invested + cash, invested, cash };
}

export function computePortfolio(input: PortfolioInput): Portfolio {
  const asOf = input.asOf ?? today();
  const assetsById: Record<string, Asset> = Object.fromEntries(
    input.assets.map((a) => [a.id, a]),
  );
  // Sin cotizacion del dolar, los pesos quedan sin convertir en vez de
  // contarse uno a uno. `fxMissing` hace que la app lo diga en pantalla.
  const fx = new FxTable(input.fxRates, 0);
  const prices = new PriceLookup(input.priceSeries);
  const quoteByAsset = new Map(input.quotes.map((q) => [q.assetId, q]));
  // Los splits que informa el proveedor entran al ledger como movimientos
  // internos, igual que uno cargado a mano: cambian las unidades desde ese
  // dia. Se calculan antes que nada porque la valuacion diaria los necesita.
  const splits = collectSplits(input.transactions, input.priceSeries);
  const txs = sortTransactions([
    ...input.transactions,
    ...providerSplitTransactions(
      splits,
      input.transactions,
      (id) => assetsById[id]?.currency ?? "USD",
    ),
  ]).filter((t) => toDay(t.date) <= asOf);

  const empty: Portfolio = {
    asOf,
    hasData: false,
    firstDay: null,
    totalValueUsd: 0,
    cashUsd: 0,
    investedUsd: 0,
    netContributedUsd: 0,
    depositedUsd: 0,
    withdrawnUsd: 0,
    unrealizedUsd: 0,
    realizedUsd: 0,
    incomeUsd: 0,
    feesUsd: 0,
    totalPnlUsd: 0,
    simpleReturn: null,
    positions: [],
    closedPositions: [],
    splits: {},
    priceMismatches: [],
    accountViews: [],
    daily: [],
    contributions: [],
    twr: [],
    metrics: {
      twrCumulative: null,
      twrAnnualized: null,
      xirr: null,
      volatility: null,
      maxDrawdown: { value: 0 },
      ageDays: 0,
    },
    fxLatest: fx.latest,
    missingPrices: [],
    fxMissing: false,
  };
  if (txs.length === 0) return empty;

  const hasArs =
    txs.some((t) => t.currency === "ARS" && !(t.fxRate && t.fxRate > 0)) ||
    input.assets.some((a) => a.currency === "ARS");
  const fxMissing = fx.isEmpty && hasArs;

  const firstDay = toDay(txs[0].date);
  const lastDay = maxDay(firstDay, asOf);

  // --- Serie diaria -------------------------------------------------------
  const state = emptyLedger();
  const daily: DailyPoint[] = [];
  const contributions: { day: DayKey; value: number }[] = [];
  let cursor = 0;
  let contributed = 0;

  for (let day = firstDay; ; day = addDays(day, 1)) {
    let flow = 0;
    while (cursor < txs.length && toDay(txs[cursor].date) <= day) {
      const tx = txs[cursor++];
      flow += externalFlowUsd(tx, fx);
      applyTransaction(state, tx, assetsById, fx);
    }
    contributed += flow;
    const { nav } = valueAt(state, day, assetsById, prices, fx, splits);
    daily.push({ day, nav, flow });
    contributions.push({ day, value: contributed });
    if (day === lastDay) break;
  }

  // --- Estado final -------------------------------------------------------
  // Para "hoy" usamos la cotizacion en vivo si la hay; si no, el ultimo cierre.
  const fxNow = fx.latest;
  const positions: PositionView[] = [];
  const missingPrices: string[] = [];
  let investedUsd = 0;

  // Historia de compras y ventas por activo, en dolares de cada dia.
  const tradesByAsset: Record<string, TradeView[]> = {};
  for (const tx of txs) {
    if ((tx.type !== "buy" && tx.type !== "sell") || !tx.assetId || !tx.quantity) continue;
    const rate = tx.fxRate && tx.fxRate > 0 ? tx.fxRate : fx.at(toDay(tx.date));
    // En pesos sin dolar conocido no hay precio en dolares: se dice que no hay
    // en vez de mandar pesos como si fueran dolares.
    const amountUsd = tx.currency === "ARS" && !(rate > 0) ? null : toUsd(tx.amount, tx.currency, rate);
    const day = toDay(tx.date);
    const f = unitsFactor(splits[tx.assetId], day);
    (tradesByAsset[tx.assetId] ??= []).push({
      day,
      side: tx.type,
      quantity: tx.quantity * f,
      priceUsd: amountUsd === null ? null : amountUsd / (tx.quantity * f),
      amountUsd,
      unitsFactor: f,
    });
  }

  for (const [assetId, lot] of Object.entries(state.positions)) {
    if (lot.quantity <= 1e-12) continue;
    const asset = assetsById[assetId];
    if (!asset) continue;
    const quote = quoteByAsset.get(assetId);
    const price = quote?.price ?? prices.at(assetId, asOf) ?? asset.manualPrice ?? null;
    const priceMissing = price === null;
    const unit = price ?? lot.avgCost;
    const valueUsd = toUsd(unit * lot.quantity, asset.currency, fxNow);
    const costUsd = lot.avgCostUsd * lot.quantity;
    const unrealizedUsd = valueUsd - costUsd;
    const realized = state.realizedByAsset[assetId] ?? 0;
    if (priceMissing) missingPrices.push(asset.symbol);
    investedUsd += valueUsd;
    positions.push({
      assetId,
      symbol: asset.symbol,
      name: asset.name,
      kind: asset.kind,
      currency: asset.currency,
      quantity: lot.quantity,
      price,
      priceUsd: price === null ? null : toUsd(price, asset.currency, fxNow),
      avgCost: lot.avgCost,
      avgCostUsd: lot.avgCostUsd,
      costUsd,
      valueUsd,
      unrealizedUsd,
      unrealizedPct: costUsd > 0 ? unrealizedUsd / costUsd : null,
      realizedUsd: realized,
      totalPnlUsd: unrealizedUsd + realized,
      weight: 0,
      dayChangePct: quote?.changePct,
      accounts: Object.entries(state.byAccount)
        .map(([accountId, held]) => ({ accountId, quantity: held[assetId] ?? 0 }))
        .filter((a) => Math.abs(a.quantity) > 1e-12),
      priceMissing,
      trades: tradesByAsset[assetId] ?? [],
    });
  }

  for (const p of positions) p.weight = investedUsd > 0 ? p.valueUsd / investedUsd : 0;
  positions.sort((a, b) => b.valueUsd - a.valueUsd);

  // --- Compras que no cierran con la cotizacion ---------------------------
  // Solo para lo que puede cambiar de ratio: acciones, ETFs y CEDEARs. Una
  // cripto no se divide, y su volatilidad simulada daria falsas alarmas.
  const priceMismatches: PriceMismatch[] = [];
  for (const pos of positions) {
    const asset = assetsById[pos.assetId];
    if (!asset || asset.source === "manual") continue;
    if (!["stock", "etf", "cedear"].includes(asset.kind)) continue;
    const muestras: { day: DayKey; paid: number; market: number; r: number }[] = [];
    for (const tx of txs) {
      if (tx.type !== "buy" || tx.assetId !== pos.assetId || !tx.quantity) continue;
      const day = toDay(tx.date);
      const serie = prices.at(pos.assetId, day);
      if (serie === null) continue;
      const market = serie * priceFactor(splits[pos.assetId], day);
      // Lo pagado por unidad, llevado a la moneda del activo con el dolar de
      // la operacion, igual que el costo promedio.
      const rate = tx.fxRate && tx.fxRate > 0 ? tx.fxRate : fx.at(day);
      const usd = toUsd(tx.amount, tx.currency, rate);
      const total =
        tx.currency === asset.currency ? tx.amount : asset.currency === "USD" ? usd : usd * rate;
      const paid = total / tx.quantity;
      if (!(market > 0) || !(paid > 0)) continue;
      muestras.push({ day, paid, market, r: paid / market });
    }
    if (muestras.length === 0) continue;
    const orden = [...muestras].sort((a, b) => a.r - b.r);
    const mediana = orden[Math.floor(orden.length / 2)];
    // Ningun dia normal separa lo pagado de la cotizacion en casi el doble.
    if (mediana.r > 1.8 || mediana.r < 0.55) {
      priceMismatches.push({
        assetId: pos.assetId,
        symbol: pos.symbol,
        day: mediana.day,
        paid: mediana.paid,
        market: mediana.market,
        currency: asset.currency,
        factor: mediana.r,
      });
    }
  }

  // Lo que se opero y ya no esta: sin esto, cualquier lectura de como invierte
  // alguien solo ve a los que sobrevivieron.
  const abiertos = new Set(positions.map((p) => p.assetId));
  const closedPositions: ClosedPositionView[] = Object.entries(tradesByAsset)
    .filter(([assetId]) => !abiertos.has(assetId) && assetsById[assetId])
    .map(([assetId, trades]) => ({
      assetId,
      symbol: assetsById[assetId].symbol,
      name: assetsById[assetId].name,
      kind: assetsById[assetId].kind,
      realizedUsd: state.realizedByAsset[assetId] ?? 0,
      trades,
    }));

  let cashUsd = 0;
  for (const acc of Object.values(state.cash)) {
    for (const [cur, amount] of Object.entries(acc)) {
      cashUsd += toUsd(amount ?? 0, cur as Currency, fxNow);
    }
  }

  const totalValueUsd = investedUsd + cashUsd;
  const unrealizedUsd = positions.reduce((s, p) => s + p.unrealizedUsd, 0);
  const totalPnlUsd = totalValueUsd - state.netContributedUsd;

  // --- Vistas por cuenta --------------------------------------------------
  const contribByAccount: Record<string, number> = {};
  for (const tx of txs) {
    const f = externalFlowUsd(tx, fx);
    if (f !== 0) contribByAccount[tx.accountId] = (contribByAccount[tx.accountId] ?? 0) + f;
    if (tx.type === "transfer" && tx.counterAccountId) {
      // Una transferencia interna no es capital nuevo, pero si mueve de que
      // cuenta "viene" la plata: la reasignamos para que el P&L por cuenta
      // no quede deformado.
      const rate = tx.fxRate && tx.fxRate > 0 ? tx.fxRate : fx.at(toDay(tx.date));
      const v = toUsd(tx.amount, tx.currency, rate);
      contribByAccount[tx.accountId] = (contribByAccount[tx.accountId] ?? 0) - v;
      contribByAccount[tx.counterAccountId] =
        (contribByAccount[tx.counterAccountId] ?? 0) + v;
    }
  }

  const accountViews: AccountView[] = input.accounts.map((account) => {
    const held = state.byAccount[account.id] ?? {};
    let invested = 0;
    for (const [assetId, qty] of Object.entries(held)) {
      const asset = assetsById[assetId];
      if (!asset || qty <= 0) continue;
      const quote = quoteByAsset.get(assetId);
      const price =
        quote?.price ??
        prices.at(assetId, asOf) ??
        asset.manualPrice ??
        state.positions[assetId]?.avgCost ??
        0;
      invested += toUsd(price * qty, asset.currency, fxNow);
    }
    const cashByCurrency = state.cash[account.id] ?? {};
    let cash = 0;
    for (const [cur, amount] of Object.entries(cashByCurrency)) {
      cash += toUsd(amount ?? 0, cur as Currency, fxNow);
    }
    const value = invested + cash;
    const net = contribByAccount[account.id] ?? 0;
    return {
      accountId: account.id,
      name: account.name,
      broker: account.broker,
      cash: cashByCurrency,
      cashUsd: cash,
      investedUsd: invested,
      valueUsd: value,
      netContributedUsd: net,
      pnlUsd: value - net,
      pnlPct: net > 0 ? (value - net) / net : null,
      weight: totalValueUsd > 0 ? value / totalValueUsd : 0,
    };
  });

  // --- Metricas -----------------------------------------------------------
  const twr = timeWeightedReturn(daily);
  const twrCumulative = twr.length ? twr[twr.length - 1].cumulative : null;
  const ageDays = daysBetween(firstDay, lastDay);
  const flows: CashFlow[] = [];
  for (const tx of txs) {
    const f = externalFlowUsd(tx, fx);
    if (f !== 0) flows.push({ day: toDay(tx.date), amount: -f });
  }
  if (totalValueUsd > 0) flows.push({ day: lastDay, amount: totalValueUsd });

  return {
    asOf,
    hasData: true,
    firstDay,
    totalValueUsd,
    cashUsd,
    investedUsd,
    netContributedUsd: state.netContributedUsd,
    depositedUsd: state.depositedUsd,
    withdrawnUsd: state.withdrawnUsd,
    unrealizedUsd,
    realizedUsd: state.realizedUsd,
    incomeUsd: state.incomeUsd,
    feesUsd: state.feesUsd,
    totalPnlUsd,
    simpleReturn:
      state.netContributedUsd > 0 ? totalPnlUsd / state.netContributedUsd : null,
    positions,
    closedPositions,
    splits,
    priceMismatches,
    accountViews,
    daily,
    contributions,
    twr,
    metrics: {
      twrCumulative,
      twrAnnualized: twrCumulative === null ? null : annualize(twrCumulative, ageDays),
      xirr: xirr(flows),
      volatility: volatility(twr),
      maxDrawdown: maxDrawdown(twr),
      ageDays,
    },
    fxLatest: fxNow,
    missingPrices: [...new Set(missingPrices)],
    fxMissing,
  };
}
