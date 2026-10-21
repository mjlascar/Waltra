import { BINANCE_API, hmacHex, type BinanceResponse, type BinanceTransport } from "./client";

/**
 * Un Binance de mentira, para los tests y para `WALTRA_MOCK=1`.
 *
 * Contesta los mismos pedidos que la sincronizacion le hace al de verdad, con
 * las mismas reglas que importan: la firma tiene que estar bien, cada
 * historial tiene su ventana maxima y su paginado, y cada pedido gasta su peso
 * del limite por minuto (en las cabeceras, como el de verdad). Un error de
 * ventana o de firma aca es un error que en el telefono no se veria hasta
 * probar con una cuenta real.
 */

const DAY = 86_400_000;

export interface FakeFill {
  id: number;
  orderId: number;
  qty: number;
  quoteQty: number;
  commission: number;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
}

export interface FakeBinance {
  apiKey: string;
  secret: string;
  /** Permisos de la clave. Por defecto, solo lectura. */
  permissions?: Record<string, boolean>;
  balances: Record<string, number>;
  /** Pares que existen, con un precio fijo para las velas. */
  prices: Record<string, number>;
  trades: Record<string, FakeFill[]>;
  deposits: { id: string; coin: string; amount: number; status: number; insertTime: number }[];
  withdrawals: { id: string; coin: string; amount: number; transactionFee: number; status: number; completeTime: number }[];
  converts: { orderId: string; fromAsset: string; fromAmount: number; toAsset: string; toAmount: number; orderStatus: string; createTime: number }[];
  p2p: {
    orderNumber: string; tradeType: "BUY" | "SELL"; asset: string; fiat: string; amount: number;
    totalPrice: number; orderStatus: string; createTime: number; commission: number; advertisementRole?: string;
  }[];
  rewards: { asset: string; rewards: number; time: number; type: "REALTIME" | "BONUS" }[];
  /** El numero de cuenta. */
  uid?: number;
  /** Lo bloqueado en ordenes abiertas, por activo (parte de `balances`). */
  locked?: Record<string, number>;
  /** El estado de una orden, si no es FILLED: para las que siguen abiertas o se cancelaron a medias. */
  orderStatus?: Record<number, string>;
  lockedRewards: { positionId: number; asset: string; amount: number; time: number }[];
  /** Si esta, todo pedido contesta este error (para probar 429, claves borradas...). */
  failWith?: { status: number; code?: number; msg?: string; retryAfter?: number };
  /** Rutas que contestan error: un historial que la cuenta no tiene. */
  unavailable?: string[];
}

/** Lo que se pidio, para que los tests puedan contar. */
export interface FakeLog {
  paths: string[];
  weight: { ip: number; sapiIp: number; uid: number };
}

const WEIGHTS: Record<string, { ip?: number; sapiIp?: number; uid?: number }> = {
  "/api/v3/time": { ip: 1 },
  "/api/v3/account": { ip: 20 },
  "/api/v3/ticker/price": { ip: 4 },
  "/api/v3/klines": { ip: 2 },
  "/api/v3/myTrades": { ip: 20 },
  "/api/v3/allOrders": { ip: 20 },
  "/sapi/v1/account/apiRestrictions": { sapiIp: 1 },
  "/sapi/v1/capital/deposit/hisrec": { sapiIp: 1 },
  "/sapi/v1/capital/withdraw/history": { uid: 18_000 },
  "/sapi/v1/convert/tradeFlow": { uid: 3_000 },
  "/sapi/v1/c2c/orderMatch/listUserOrderHistory": { sapiIp: 1 },
  "/sapi/v1/fiat/orders": { uid: 45_000 },
  "/sapi/v1/fiat/payments": { sapiIp: 1 },
  "/sapi/v1/simple-earn/flexible/history/rewardsRecord": { sapiIp: 150 },
  "/sapi/v1/simple-earn/locked/history/rewardsRecord": { sapiIp: 150 },
};

const SIGNED = new Set(Object.keys(WEIGHTS).filter((p) => !["/api/v3/time", "/api/v3/ticker/price", "/api/v3/klines"].includes(p)));

function error(status: number, code: number, msg: string): BinanceResponse {
  return { status, headers: {}, body: { code, msg } };
}

function within(t: number, s?: number, e?: number) {
  return (s === undefined || t >= s) && (e === undefined || t <= e);
}

export function fakeTransport(
  data: FakeBinance,
  options: { now?: () => number; log?: FakeLog } = {},
): BinanceTransport {
  const now = options.now ?? Date.now;
  let minute = Math.floor(now() / 60_000);
  const used = { ip: 0, sapiIp: 0, uid: 0 };

  return async ({ url, apiKey }) => {
    if (!url.startsWith(`${BINANCE_API}/`)) throw new Error(`pedido fuera de Binance: ${url}`);
    const u = new URL(url);
    const path = u.pathname;
    const q = u.searchParams;
    const int = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);

    const m = Math.floor(now() / 60_000);
    if (m !== minute) {
      minute = m;
      used.ip = used.sapiIp = used.uid = 0;
    }
    const w = WEIGHTS[path];
    if (!w) return error(404, -1000, `ruta desconocida ${path}`);
    used.ip += w.ip ?? 0;
    used.sapiIp += w.sapiIp ?? 0;
    used.uid += w.uid ?? 0;
    options.log?.paths.push(path);
    if (options.log) options.log.weight = { ...used };
    const headers: Record<string, string> = {
      "x-mbx-used-weight-1m": String(used.ip),
      "x-sapi-used-ip-weight-1m": String(used.sapiIp),
      ...(w.uid ? { "x-sapi-used-uid-weight-1m": String(used.uid) } : {}),
    };
    const ok = (body: unknown): BinanceResponse => ({ status: 200, headers, body });

    if (data.failWith) {
      const f = data.failWith;
      return {
        status: f.status,
        headers: { ...headers, ...(f.retryAfter ? { "retry-after": String(f.retryAfter) } : {}) },
        body: { code: f.code ?? -1000, msg: f.msg ?? "falla simulada" },
      };
    }
    if (data.unavailable?.includes(path)) return error(400, -1002, "No disponible para esta cuenta.");

    if (SIGNED.has(path)) {
      if (apiKey !== data.apiKey) return error(401, -2015, "Invalid API-key, IP, or permissions for action.");
      const firma = q.get("signature");
      const sinFirma = u.search.slice(1).replace(/&signature=[0-9a-f]+$/, "");
      if (!firma || firma !== (await hmacHex(data.secret, sinFirma))) return error(400, -1022, "Signature for this request is not valid.");
      const ts = int("timestamp") ?? 0;
      const recv = int("recvWindow") ?? 5000;
      if (recv > 60_000) return error(400, -1131, "recvWindow must be less than 60000");
      if (Math.abs(now() - ts) > recv) return error(400, -1021, "Timestamp for this request is outside of the recvWindow.");
    }

    const s = int("startTime") ?? int("startTimestamp") ?? int("beginTime");
    const e = int("endTime") ?? int("endTimestamp");
    const ventana = (max: number) => s !== undefined && e !== undefined && e - s > max;

    switch (path) {
      case "/api/v3/time":
        return ok({ serverTime: now() });
      case "/sapi/v1/account/apiRestrictions":
        return ok({ enableReading: true, ipRestrict: false, createTime: 0, ...data.permissions });
      case "/api/v3/account":
        return ok({
          uid: data.uid ?? 4242,
          balances: Object.entries(data.balances)
            .filter(([, v]) => v > 0 || q.get("omitZeroBalances") !== "true")
            .map(([asset, v]) => {
              const locked = data.locked?.[asset] ?? 0;
              return { asset, free: String(v - locked), locked: String(locked) };
            }),
        });
      case "/api/v3/ticker/price":
        return ok(Object.entries(data.prices).map(([symbol, price]) => ({ symbol, price: String(price) })));
      case "/api/v3/klines": {
        const p = data.prices[q.get("symbol") ?? ""];
        if (!p) return error(400, -1121, "Invalid symbol.");
        return ok([[s ?? 0, String(p), String(p), String(p), String(p), "1", 0, "0", 1, "0", "0", "0"]]);
      }
      case "/api/v3/allOrders": {
        const symbol = q.get("symbol") ?? "";
        if (!data.prices[symbol]) return error(400, -1121, "Invalid symbol.");
        const porOrden = new Map<number, FakeFill[]>();
        for (const t of data.trades[symbol] ?? []) porOrden.set(t.orderId, [...(porOrden.get(t.orderId) ?? []), t]);
        // Como Binance: las mas recientes, ordenadas por id de la mas vieja a la mas nueva.
        const limit = Math.min(int("limit") ?? 500, 1000);
        const ordenes = [...porOrden.entries()]
          .map(([orderId, fs]) => ({
            symbol,
            orderId,
            status: data.orderStatus?.[orderId] ?? "FILLED",
            side: fs[0].isBuyer ? "BUY" : "SELL",
            executedQty: String(fs.reduce((a, f) => a + f.qty, 0)),
            cummulativeQuoteQty: String(fs.reduce((a, f) => a + f.quoteQty, 0)),
            time: Math.min(...fs.map((f) => f.time)),
            updateTime: Math.max(...fs.map((f) => f.time)),
          }))
          .sort((a, b) => a.orderId - b.orderId);
        return ok(ordenes.slice(-limit));
      }
      case "/api/v3/myTrades": {
        const symbol = q.get("symbol") ?? "";
        if (!data.prices[symbol]) return error(400, -1121, "Invalid symbol.");
        const all = [...(data.trades[symbol] ?? [])].sort((a, b) => a.id - b.id);
        const orderId = int("orderId");
        if (orderId !== undefined) return ok(all.filter((t) => t.orderId === orderId).map(trade(symbol)));
        const fromId = int("fromId");
        const limit = Math.min(int("limit") ?? 500, 1000);
        const lista = fromId !== undefined ? all.filter((t) => t.id >= fromId).slice(0, limit) : all.slice(-limit);
        return ok(lista.map(trade(symbol)));
      }
      case "/sapi/v1/capital/deposit/hisrec": {
        if (ventana(90 * DAY)) return error(400, -1127, "More than 90 days between startTime and endTime.");
        const offset = int("offset") ?? 0;
        const limit = int("limit") ?? 1000;
        return ok(data.deposits.filter((d) => within(d.insertTime, s, e)).slice(offset, offset + limit)
          .map((d) => ({ ...d, amount: String(d.amount) })));
      }
      case "/sapi/v1/capital/withdraw/history": {
        if (ventana(90 * DAY)) return error(400, -1127, "More than 90 days between startTime and endTime.");
        const offset = int("offset") ?? 0;
        const limit = int("limit") ?? 1000;
        return ok(data.withdrawals.filter((x) => within(x.completeTime, s, e)).slice(offset, offset + limit)
          .map((x) => ({
            ...x,
            amount: String(x.amount),
            transactionFee: String(x.transactionFee),
            applyTime: new Date(x.completeTime).toISOString().slice(0, 19).replace("T", " "),
            completeTime: new Date(x.completeTime).toISOString().slice(0, 19).replace("T", " "),
          })));
      }
      case "/sapi/v1/convert/tradeFlow": {
        if (s === undefined || e === undefined) return error(400, -1102, "startTime y endTime son obligatorios.");
        if (ventana(30 * DAY)) return error(400, -1127, "More than 30 days between startTime and endTime.");
        const limit = int("limit") ?? 100;
        const todos = data.converts.filter((c) => within(c.createTime, s, e)).sort((a, b) => a.createTime - b.createTime);
        return ok({ list: todos.slice(0, limit).map((c) => ({ ...c, fromAmount: String(c.fromAmount), toAmount: String(c.toAmount) })),
          startTime: s, endTime: e, limit, moreData: todos.length > limit });
      }
      case "/sapi/v1/c2c/orderMatch/listUserOrderHistory": {
        if (ventana(30 * DAY)) return error(400, -1127, "More than 30 days between startTimestamp and endTimestamp.");
        const page = int("page") ?? 1;
        const rows = int("rows") ?? 100;
        const todos = data.p2p.filter((o) => o.tradeType === q.get("tradeType") && within(o.createTime, s, e));
        return ok({ code: "000000", message: "success", success: true, total: todos.length,
          data: todos.slice((page - 1) * rows, page * rows).map((o) => ({ ...o, amount: String(o.amount),
            totalPrice: String(o.totalPrice), commission: String(o.commission), takerCommission: String(o.commission) })) });
      }
      case "/sapi/v1/fiat/orders":
      case "/sapi/v1/fiat/payments":
        return ok({ code: "000000", message: "success", data: [], total: 0, success: true });
      case "/sapi/v1/simple-earn/flexible/history/rewardsRecord": {
        if (ventana(30 * DAY)) return error(400, -1127, "More than 30 days between startTime and endTime.");
        const current = int("current") ?? 1;
        const size = int("size") ?? 10;
        const tipo = q.get("type");
        const todos = data.rewards.filter((r) => (!tipo || tipo === "ALL" || r.type === tipo) && within(r.time, s, e));
        return ok({ rows: todos.slice((current - 1) * size, current * size)
          .map((r) => ({ asset: r.asset, rewards: String(r.rewards), projectId: `${r.asset}001`, type: r.type, time: r.time })),
          total: todos.length });
      }
      case "/sapi/v1/simple-earn/locked/history/rewardsRecord": {
        if (ventana(30 * DAY)) return error(400, -1127, "More than 30 days between startTime and endTime.");
        const current = int("current") ?? 1;
        const size = int("size") ?? 10;
        const todos = data.lockedRewards.filter((r) => within(r.time, s, e));
        return ok({ rows: todos.slice((current - 1) * size, current * size)
          .map((r) => ({ ...r, amount: String(r.amount), lockPeriod: "30", type: "Locked Rewards" })), total: todos.length });
      }
    }
    return error(404, -1000, `ruta desconocida ${path}`);
  };
}

function trade(symbol: string) {
  return (t: FakeFill) => ({
    symbol,
    id: t.id,
    orderId: t.orderId,
    orderListId: -1,
    price: String(t.quoteQty / t.qty),
    qty: String(t.qty),
    quoteQty: String(t.quoteQty),
    commission: String(t.commission),
    commissionAsset: t.commissionAsset,
    time: t.time,
    isBuyer: t.isBuyer,
    isMaker: false,
    isBestMatch: true,
  });
}

/** Una cuenta vacia, para que los tests agreguen solo lo que prueban. */
export function emptyFake(): FakeBinance {
  return {
    apiKey: "clave-de-prueba-0000000000000000000000000000",
    secret: "secreto-de-prueba-000000000000000000000000000",
    balances: {},
    prices: { BTCUSDT: 60_000, ETHUSDT: 3_000, BNBUSDT: 600, ETHBTC: 0.05, USDTARS: 1_500, SOLUSDT: 150 },
    trades: {},
    deposits: [],
    withdrawals: [],
    converts: [],
    p2p: [],
    rewards: [],
    lockedRewards: [],
  };
}

let demo: BinanceTransport | null = null;

/**
 * El Binance de `WALTRA_MOCK=1`, uno por servidor: la cuenta de ejemplo no
 * cambia entre un pedido y el siguiente. Se entra con la clave y el secreto de
 * `emptyFake()`, que son de prueba y no abren nada real.
 */
export function mockBinance(): BinanceTransport {
  if (!demo) demo = fakeTransport(demoFake());
  return demo;
}

/**
 * La cuenta de ejemplo de `WALTRA_MOCK=1`: un poco de todo en las ultimas
 * semanas, para ver la conexion andando sin una cuenta real.
 */
export function demoFake(now = Date.now()): FakeBinance {
  const d = (dias: number) => now - dias * DAY;
  const f = emptyFake();
  // Los saldos son los que dejan los movimientos de abajo: la cuenta cierra.
  f.balances = { BTC: 0.00999, ETH: 0.4997, USDT: 100 };
  f.deposits = [{ id: "dep-demo-1", coin: "USDT", amount: 1500, status: 1, insertTime: d(20) }];
  f.trades = {
    BTCUSDT: [
      { id: 1, orderId: 9001, qty: 0.01, quoteQty: 600, commission: 0.00001, commissionAsset: "BTC", time: d(18), isBuyer: true },
    ],
    ETHUSDT: [
      { id: 1, orderId: 9101, qty: 0.3, quoteQty: 900, commission: 0.0003, commissionAsset: "ETH", time: d(12), isBuyer: true },
    ],
  };
  f.p2p = [{ orderNumber: "p2p-demo-1", tradeType: "BUY", asset: "USDT", fiat: "ARS", amount: 700, totalPrice: 1_050_000,
    orderStatus: "COMPLETED", createTime: d(15), commission: 0 }];
  f.converts = [{ orderId: "cv-demo-1", fromAsset: "USDT", fromAmount: 600, toAsset: "ETH", toAmount: 0.2,
    orderStatus: "SUCCESS", createTime: d(5) }];
  return f;
}
