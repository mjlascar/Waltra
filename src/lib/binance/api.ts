import { BinanceError, type BinanceClient } from "./client";

/**
 * Los historiales de Binance que lee Waltra, ya leidos y con numeros.
 *
 * Binance manda los montos como texto ("0.03300000") y cada historial tiene
 * su propio limite de ventana: los ingresos y retiros aceptan hasta 90 dias
 * por pedido, Convert, P2P y Earn hasta 30. Cada funcion de aca lee una sola
 * ventana, con sus paginas; partir el rango lo decide `sync.ts`, que es quien
 * lleva la cuenta de cuanto se le pidio a Binance en este minuto.
 */

export const DAY = 86_400_000;

/** El tamaño de ventana de cada historial. */
export const WINDOW = {
  deposits: 89 * DAY,
  withdrawals: 89 * DAY,
  fiat: 89 * DAY,
  converts: 30 * DAY - 1,
  p2p: 30 * DAY - 1,
  rewards: 30 * DAY - 1,
};

/** Binance solo guarda seis meses de P2P en la API. */
export const P2P_HISTORY = 180 * DAY;

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object") : [];

interface Envelope {
  data?: unknown;
  code?: unknown;
  success?: unknown;
  message?: unknown;
}

/**
 * P2P y moneda local contestan los errores con HTTP 200 y su propio codigo
 * ("000000" es que salio bien). Leido como una lista vacia, el cursor pasaria
 * de largo y lo de esa ventana no se traeria nunca.
 */
function checked(r: Envelope): Envelope {
  const code = typeof r.code === "string" ? r.code : undefined;
  if (r.success === false || (code !== undefined && code !== "000000")) {
    throw new BinanceError(typeof r.message === "string" && r.message ? r.message : `Binance devolvió ${code}.`, "api");
  }
  return r;
}

/** Parte [start, end] en ventanas de a lo sumo `max` ms. */
export function windows(start: number, end: number, max: number): [number, number][] {
  const out: [number, number][] = [];
  for (let s = start; s <= end; s += max) out.push([s, Math.min(end, s + max - 1)]);
  return out;
}

// ---------------------------------------------------------------------------
// La clave

/** Permisos que una clave de solo lectura no tiene que tener. */
const RIESGOSOS: Record<string, string> = {
  enableSpotAndMarginTrading: "operar",
  enableWithdrawals: "retirar",
  enableInternalTransfer: "transferir entre cuentas",
  permitsUniversalTransfer: "transferir entre billeteras",
  enableMargin: "operar con margen",
  enableFutures: "operar futuros",
  enableVanillaOptions: "operar opciones",
  enablePortfolioMarginTrading: "operar con margen de cartera",
  enableFixApiTrade: "operar por FIX",
};

export interface KeyCheck {
  canRead: boolean;
  /** Lo que la clave puede hacer y no deberia, en palabras. */
  risky: string[];
}

export async function checkKey(c: BinanceClient): Promise<KeyCheck> {
  const r = await c.signed<Record<string, unknown>>("/sapi/v1/account/apiRestrictions");
  return {
    canRead: r.enableReading === true,
    risky: Object.entries(RIESGOSOS)
      .filter(([campo]) => r[campo] === true)
      .map(([, texto]) => texto),
  };
}

// ---------------------------------------------------------------------------
// Saldos, pares y precios

export interface SpotAccount {
  /** El numero de cuenta de Binance: una clave de otra cuenta no sigue donde quedo esta. */
  uid?: number;
  /** Lo que hay en la billetera spot, libre mas bloqueado en ordenes abiertas. */
  balances: Record<string, number>;
}

export async function spotAccount(c: BinanceClient): Promise<SpotAccount> {
  const r = await c.signed<{ balances?: unknown; uid?: unknown }>("/api/v3/account", { omitZeroBalances: true });
  const balances: Record<string, number> = {};
  for (const b of list(r.balances)) {
    const total = num(b.free) + num(b.locked);
    if (total > 0) balances[str(b.asset)] = total;
  }
  const uid = num(r.uid);
  return { uid: uid > 0 ? uid : undefined, balances };
}

/**
 * Los activos que hubo en la billetera spot en el ultimo mes, dia por dia.
 * Es lo unico que muestra una cripto que se compro y se vendio entera: su
 * saldo de hoy es cero y no aparece en ningun otro historial. Pesa 2400.
 */
export async function snapshotAssets(c: BinanceClient, start: number, end: number): Promise<Set<string>> {
  const r = await c.signed<{ snapshotVos?: unknown }>("/sapi/v1/accountSnapshot", {
    type: "SPOT",
    startTime: start,
    endTime: end,
    limit: 30,
  });
  const out = new Set<string>();
  for (const vo of list(r.snapshotVos)) {
    const data = vo.data && typeof vo.data === "object" ? (vo.data as Record<string, unknown>) : {};
    for (const b of list(data.balances)) {
      if (num(b.free) + num(b.locked) > 0) out.add(str(b.asset));
    }
  }
  return out;
}

/** Los pares que existen hoy. Pesa 4 y trae todos de una vez. */
export async function symbols(c: BinanceClient): Promise<Set<string>> {
  const r = await c.public<unknown>("/api/v3/ticker/price");
  return new Set(list(r).map((p) => str(p.symbol)).filter(Boolean));
}

/**
 * El precio de un par en un momento: el promedio de la vela de una hora que
 * lo contiene. Alcanza para valuar lo que llego de otra billetera o lo que
 * pago Earn, y es un dato que no cambia.
 */
export async function hourPrice(c: BinanceClient, symbol: string, at: number): Promise<number | null> {
  const start = Math.floor(at / 3_600_000) * 3_600_000;
  try {
    const r = await c.public<unknown[]>("/api/v3/klines", { symbol, interval: "1h", startTime: start, limit: 1 });
    // [abre, apertura, maximo, minimo, cierre, volumen, cierra, ...]
    const vela = Array.isArray(r) && Array.isArray(r[0]) ? (r[0] as unknown[]) : null;
    if (!vela) return null;
    // Antes de que el par existiera, Binance devuelve la primera vela que
    // tiene: un precio de otro momento, que vale menos que no tener ninguno.
    if (num(vela[0]) > at || (num(vela[6]) > 0 && num(vela[6]) < at)) return null;
    const p = (num(vela[1]) + num(vela[4])) / 2;
    return p > 0 ? p : null;
  } catch (err) {
    // Un par que no existe no es un error de la pasada: es que no hay precio.
    if (err instanceof BinanceError && err.kind === "api") return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Operaciones spot

export interface Fill {
  id: number;
  orderId: number;
  qty: number;
  quoteQty: number;
  commission: number;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
}

function fills(r: unknown): Fill[] {
  return list(r).map((t) => ({
    id: num(t.id),
    orderId: num(t.orderId),
    qty: num(t.qty),
    quoteQty: num(t.quoteQty),
    commission: num(t.commission),
    commissionAsset: str(t.commissionAsset),
    time: num(t.time),
    isBuyer: t.isBuyer === true,
  }));
}

export const TRADES_PAGE = 1000;

/** Una pagina de ejecuciones de un par desde un id, de la mas vieja a la mas nueva. */
export async function tradesPage(c: BinanceClient, symbol: string, fromId: number): Promise<Fill[]> {
  return fills(await c.signed("/api/v3/myTrades", { symbol, fromId, limit: TRADES_PAGE }));
}

/** Las ejecuciones de una orden, para rearmarla entera si se ejecuto en partes. */
export async function orderFills(c: BinanceClient, symbol: string, orderId: number): Promise<Fill[]> {
  return fills(await c.signed("/api/v3/myTrades", { symbol, orderId, limit: TRADES_PAGE }));
}

// ---------------------------------------------------------------------------
// Ingresos y retiros de cripto

export interface Deposit {
  id: string;
  coin: string;
  amount: number;
  /** 1 acreditado, 6 acreditado pero todavia sin poder retirarse; el resto, pendiente o rechazado. */
  status: number;
  time: number;
}

export async function deposits(c: BinanceClient, start: number, end: number): Promise<Deposit[]> {
  const out: Deposit[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = list(await c.signed("/sapi/v1/capital/deposit/hisrec", { startTime: start, endTime: end, offset, limit: 1000 }));
    out.push(
      ...page.map((d) => ({
        id: str(d.id) || str(d.txId),
        coin: str(d.coin),
        amount: num(d.amount),
        status: num(d.status),
        time: num(d.insertTime),
      })),
    );
    if (page.length < 1000) return out;
  }
}

export interface Withdrawal {
  id: string;
  coin: string;
  /**
   * Lo que llega a destino. La comision de la red va aparte, en la misma
   * moneda: de la cuenta sale `amount + fee`.
   */
  amount: number;
  fee: number;
  /** 6 completado; el resto, en curso, rechazado o cancelado. */
  status: number;
  time: number;
}

/** El historial de retiros da la fecha como texto, "2019-10-12 11:12:02", en UTC. */
function binanceTime(v: unknown): number {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) {
    return Date.parse(`${v.replace(" ", "T")}Z`);
  }
  return num(v);
}

export async function withdrawals(c: BinanceClient, start: number, end: number): Promise<Withdrawal[]> {
  const out: Withdrawal[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = list(await c.signed("/sapi/v1/capital/withdraw/history", { startTime: start, endTime: end, offset, limit: 1000 }));
    out.push(
      ...page.map((w) => ({
        id: str(w.id),
        coin: str(w.coin),
        amount: num(w.amount),
        fee: num(w.transactionFee),
        status: num(w.status),
        time: binanceTime(w.completeTime) || binanceTime(w.applyTime),
      })),
    );
    if (page.length < 1000) return out;
  }
}

// ---------------------------------------------------------------------------
// Convert

export interface Convert {
  orderId: string;
  from: string;
  fromAmount: number;
  to: string;
  toAmount: number;
  status: string;
  time: number;
}

export async function converts(c: BinanceClient, start: number, end: number): Promise<Convert[]> {
  const out: Convert[] = [];
  let desde = start;
  for (;;) {
    const r = await c.signed<{ list?: unknown; moreData?: unknown }>("/sapi/v1/convert/tradeFlow", {
      startTime: desde,
      endTime: end,
      limit: 1000,
    });
    const page = list(r.list).map((x) => ({
      orderId: str(x.orderId),
      from: str(x.fromAsset),
      fromAmount: num(x.fromAmount),
      to: str(x.toAsset),
      toAmount: num(x.toAmount),
      status: str(x.orderStatus),
      time: num(x.createTime),
    }));
    out.push(...page);
    if (r.moreData !== true || page.length === 0) return out;
    desde = Math.max(...page.map((x) => x.time)) + 1;
  }
}

// ---------------------------------------------------------------------------
// P2P

export interface P2POrder {
  orderNumber: string;
  side: "BUY" | "SELL";
  asset: string;
  fiat: string;
  /** Cripto de la orden. */
  amount: number;
  /** Lo que se pago o cobro en la moneda local. */
  total: number;
  /** Comision de Binance, en cripto. */
  fee: number;
  status: string;
  time: number;
}

export async function p2pOrders(c: BinanceClient, start: number, end: number): Promise<P2POrder[]> {
  const out: P2POrder[] = [];
  for (const side of ["BUY", "SELL"] as const) {
    for (let page = 1; ; page++) {
      const r = checked(await c.signed<Envelope>("/sapi/v1/c2c/orderMatch/listUserOrderHistory", {
        tradeType: side,
        startTimestamp: start,
        endTimestamp: end,
        page,
        rows: 100,
      }));
      const rows = list(r.data);
      out.push(
        ...rows.map((o) => ({
          orderNumber: str(o.orderNumber),
          side,
          asset: str(o.asset),
          fiat: str(o.fiat),
          amount: num(o.amount),
          total: num(o.totalPrice),
          fee: str(o.advertisementRole) === "TAKER" ? num(o.takerCommission) : num(o.commission),
          status: str(o.orderStatus),
          time: num(o.createTime),
        })),
      );
      if (rows.length < 100) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Moneda local: transferencias bancarias y compras con tarjeta

export interface FiatOrder {
  orderNo: string;
  kind: "deposit" | "withdraw";
  fiat: string;
  /** Lo pedido, comision incluida. */
  amount: number;
  fee: number;
  status: string;
  time: number;
}

export async function fiatOrders(c: BinanceClient, start: number, end: number): Promise<FiatOrder[]> {
  const out: FiatOrder[] = [];
  for (const [tipo, kind] of [["0", "deposit"], ["1", "withdraw"]] as const) {
    for (let page = 1; ; page++) {
      const r = checked(await c.signed<Envelope>("/sapi/v1/fiat/orders", {
        transactionType: tipo,
        beginTime: start,
        endTime: end,
        page,
        rows: 500,
      }));
      const rows = list(r.data);
      out.push(
        ...rows.map((o) => ({
          orderNo: str(o.orderNo),
          kind,
          fiat: str(o.fiatCurrency),
          amount: num(o.indicatedAmount) || num(o.amount),
          fee: num(o.totalFee),
          status: str(o.status),
          time: num(o.createTime),
        })),
      );
      if (rows.length < 500) break;
    }
  }
  return out;
}

export interface FiatPayment {
  orderNo: string;
  fiat: string;
  /** Lo que se pago, comision incluida. */
  paid: number;
  crypto: string;
  obtained: number;
  status: string;
  time: number;
}

/** Compras de cripto con tarjeta o transferencia. Las ventas por este camino no se leen. */
export async function fiatPayments(c: BinanceClient, start: number, end: number): Promise<FiatPayment[]> {
  const out: FiatPayment[] = [];
  for (let page = 1; ; page++) {
    const r = checked(await c.signed<Envelope>("/sapi/v1/fiat/payments", {
      transactionType: "0",
      beginTime: start,
      endTime: end,
      page,
      rows: 500,
    }));
    const rows = list(r.data);
    out.push(
      ...rows.map((o) => ({
        orderNo: str(o.orderNo),
        fiat: str(o.fiatCurrency),
        paid: num(o.sourceAmount),
        crypto: str(o.cryptoCurrency),
        obtained: num(o.obtainAmount),
        status: str(o.status),
        time: num(o.createTime),
      })),
    );
    if (rows.length < 500) return out;
  }
}

// ---------------------------------------------------------------------------
// Earn

export interface Reward {
  asset: string;
  amount: number;
  time: number;
}

/**
 * Lo que pago Simple Earn, flexible y bloqueado. Del flexible se piden por
 * separado el rendimiento comun y el bonus: "todos los tipos" incluye el
 * historico, que en algunas cuentas repite lo mismo con otro nombre.
 */
export async function rewards(c: BinanceClient, start: number, end: number): Promise<Reward[]> {
  const out: Reward[] = [];
  for (const type of ["REALTIME", "BONUS"] as const) {
    for (let current = 1; ; current++) {
      const r = await c.signed<{ rows?: unknown }>("/sapi/v1/simple-earn/flexible/history/rewardsRecord", {
        type,
        startTime: start,
        endTime: end,
        current,
        size: 100,
      });
      const rows = list(r.rows);
      out.push(...rows.map((x) => ({ asset: str(x.asset), amount: num(x.rewards), time: num(x.time) })));
      if (rows.length < 100) break;
    }
  }
  for (let current = 1; ; current++) {
    const r = await c.signed<{ rows?: unknown }>("/sapi/v1/simple-earn/locked/history/rewardsRecord", {
      startTime: start,
      endTime: end,
      current,
      size: 100,
    });
    const rows = list(r.rows);
    out.push(...rows.map((x) => ({ asset: str(x.asset), amount: num(x.amount), time: num(x.time) })));
    if (rows.length < 100) break;
  }
  return out.filter((r) => r.amount > 0 && r.asset && r.time >= start && r.time <= end);
}
