import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WaltraDB, ensureSeeded } from "@/lib/db";
import { BinanceClient, type BinanceTransport } from "../client";
import { demoFake, emptyFake, fakeTransport, type FakeBinance, type FakeFill, type FakeLog } from "../fake";
import { connectBinance, connectWarnings, defaultSince, disconnectBinance, forgetBinanceTx, MIN_INTERVAL, runBinance } from "../sync";
import { buildLedger } from "@/lib/engine/ledger";
import { FxTable } from "@/lib/engine/fx";
import type { Asset, Transaction } from "@/lib/types";

const DAY = 86_400_000;
const START = Date.parse("2026-10-21T12:00:00Z");

let db: WaltraDB;
let clock: number;
let fake: FakeBinance;
let log: FakeLog;
let n = 0;

const now = () => clock;
const client = (t?: BinanceTransport) =>
  new BinanceClient({ apiKey: fake.apiKey, secret: fake.secret }, t ?? fakeTransport(fake, { now, log }), now);
const run = (force = false, t?: BinanceTransport) => runBinance(db, client(t), { now, force });
const later = (ms = MIN_INTERVAL + 1000) => {
  clock += ms;
};
const calls = (path: string) => log.paths.filter((p) => p === path).length;

async function connect(since: string, accountId = "binance", dropEstimate = false) {
  const error = await connectBinance(db, client(), { apiKey: fake.apiKey, secret: fake.secret, accountId, since, dropEstimate });
  expect(error).toBeNull();
}

async function ledger() {
  const [txs, assets] = await Promise.all([db.transactions.toArray(), db.assets.toArray()]);
  const byId: Record<string, Asset> = Object.fromEntries(assets.map((a) => [a.id, a]));
  const state = buildLedger(txs, byId, new FxTable([{ date: "2026-01-01", arsPerUsd: 1500 }], 0));
  const units = (symbol: string) => {
    const a = assets.find((x) => x.symbol === symbol);
    return a ? (state.positions[a.id]?.quantity ?? 0) : 0;
  };
  return { state, units, txs };
}

const iso = "2026-10-01T00:00:00Z";
const manual = (t: Partial<Transaction> & Pick<Transaction, "id" | "date" | "type" | "amount">): Transaction => ({
  accountId: "binance", currency: "USD", createdAt: iso, updatedAt: iso, ...t,
});
const buyFill = (id: number, orderId: number, qty: number, quote: number, time: number): FakeFill => ({
  id, orderId, qty, quoteQty: quote, commission: 0, commissionAsset: "BTC", time, isBuyer: true,
});

beforeEach(async () => {
  db = new WaltraDB(`binance-${++n}`);
  await db.open();
  await ensureSeeded(db);
  clock = START;
  fake = emptyFake();
  log = { paths: [], weight: { ip: 0, sapiIp: 0, uid: 0 } };
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe("conectar", () => {
  it("rechaza una clave que puede operar o retirar", async () => {
    fake.permissions = { enableSpotAndMarginTrading: true, enableWithdrawals: true };
    const error = await connectBinance(db, client(), { apiKey: fake.apiKey, secret: fake.secret, accountId: "binance", since: "2026-10-01" });
    expect(error).toMatch(/operar, retirar/);
    expect(await db.connections.get("binance")).toBeUndefined();
  });

  it("rechaza una clave que Binance no conoce, o un secreto mal copiado", async () => {
    const otra = new BinanceClient({ apiKey: "otra", secret: fake.secret }, fakeTransport(fake, { now }), now);
    expect(await connectBinance(db, otra, { apiKey: "otra", secret: fake.secret, accountId: "binance", since: "2026-10-01" })).toMatch(/no reconoce/);
    const mal = new BinanceClient({ apiKey: fake.apiKey, secret: "mal" }, fakeTransport(fake, { now }), now);
    expect(await connectBinance(db, mal, { apiKey: fake.apiKey, secret: "mal", accountId: "binance", since: "2026-10-01" })).toMatch(/no reconoce/);
  });

  it("propone traer desde el ultimo dia cargado en la cuenta, o el ultimo mes", () => {
    const txs = [
      { accountId: "binance", date: "2026-09-02" },
      { accountId: "binance", date: "2026-10-03" },
      { accountId: "cocos", date: "2026-10-20" },
    ];
    expect(defaultSince(txs, "binance")).toBe("2026-10-03");
    expect(defaultSince(txs, "otra", "2026-10-21")).toBe("2026-09-21");
  });
});

describe("la primera pasada", () => {
  it("trae lo ultimo de cada cosa, y las cuentas cierran con Binance", async () => {
    fake = demoFake(START);
    await connect("2026-09-01");
    const r = await run();
    expect(r?.error).toBeUndefined();
    expect(r?.partial).toBe(false);
    const { txs, units, state } = await ledger();
    expect(txs.map((t) => t.id).sort()).toEqual([
      "binance-9001",
      "binance-9101",
      "binance-cv-cv-demo-1",
      "binance-ing-dep-demo-1",
      "binance-p2p-p2p-demo-1",
      "binance-p2p-p2p-demo-1-c",
    ]);
    expect(units("BTC")).toBeCloseTo(fake.balances.BTC, 10);
    expect(units("ETH")).toBeCloseTo(fake.balances.ETH, 10);
    expect(state.cash.binance?.USD).toBeCloseTo(fake.balances.USDT, 6);
    expect(state.cash.binance?.ARS ?? 0).toBeCloseTo(0, 6);
    expect(state.netContributedUsd).toBeCloseTo(2200, 6);
  });

  it("nada de antes del punto de partida", async () => {
    fake = demoFake(START);
    // La orden de ETH es del 9 y el Convert del 16; lo demas, de antes.
    await connect("2026-10-09");
    await run();
    expect((await db.transactions.toArray()).map((t) => t.id).sort()).toEqual(["binance-9101", "binance-cv-cv-demo-1"]);
  });

  it("los activos nuevos entran como cripto de Binance, y los que ya estaban se usan", async () => {
    fake = demoFake(START);
    await db.assets.put({ id: "mi-btc", symbol: "BTC", name: "Bitcoin", kind: "crypto", currency: "USD", source: "binance", sourceSymbol: "BTCUSDT", precision: 8 });
    await connect("2026-09-01");
    const r = await run();
    expect(r?.newAssets).toBe(1);
    expect((await db.transactions.get("binance-9001"))?.assetId).toBe("mi-btc");
    expect((await db.assets.toArray()).find((a) => a.symbol === "ETH")).toMatchObject({ kind: "crypto", source: "binance", sourceSymbol: "ETHUSDT" });
  });
});

describe("solo lo ultimo, y lo que ya esta no se toca", () => {
  it("para en lo primero que ya estaba: lo de antes queda como lo dejo el usuario", async () => {
    fake.deposits = [
      { id: "viejo", coin: "USDT", amount: 100, status: 1, insertTime: clock - 10 * DAY },
      { id: "medio", coin: "USDT", amount: 200, status: 1, insertTime: clock - 5 * DAY },
      { id: "nuevo", coin: "USDT", amount: 300, status: 1, insertTime: clock - 1 * DAY },
    ];
    // El del medio lo habia cargado a mano; el viejo no, por algo.
    await db.transactions.put(manual({ id: "a-mano", date: "2026-10-16", type: "deposit", amount: 200 }));
    await connect("2026-10-01");
    const r = await run();
    expect(r).toMatchObject({ added: 1, dupes: 1 });
    expect(await db.transactions.get("binance-ing-nuevo")).toBeDefined();
    expect(await db.transactions.get("binance-ing-viejo")).toBeUndefined();
  });

  it("si las diez ultimas ordenes son todas nuevas, pide mas", async () => {
    fake.prices = { BTCUSDT: 60_000 };
    fake.balances = { BTC: 0.015 };
    fake.trades.BTCUSDT = Array.from({ length: 15 }, (_, i) => buyFill(i + 1, 100 + i, 0.001, 60, clock - (15 - i) * 3_600_000));
    await connect("2026-10-01");
    const r = await run();
    expect(r?.added).toBe(15);
    expect(calls("/api/v3/allOrders")).toBe(2);
  });

  it("pide de a poco: 10, 20, 50, 100, mientras todo sea nuevo", async () => {
    fake.prices = { BTCUSDT: 60_000 };
    fake.balances = { BTC: 0.06 };
    fake.trades.BTCUSDT = Array.from({ length: 60 }, (_, i) => buyFill(i + 1, 100 + i, 0.001, 60, clock - (60 - i) * 3_600_000));
    await connect("2026-10-01");
    const r = await run();
    expect(r?.added).toBe(60);
    // 10, 20 y 50 llegaron llenas y todas nuevas; la de 100 trajo 60: no hay mas.
    expect(calls("/api/v3/allOrders")).toBe(4);
  });

  it("y para en el pedido donde aparece lo que ya estaba", async () => {
    fake.prices = { BTCUSDT: 60_000 };
    fake.balances = { BTC: 0.035 };
    fake.trades.BTCUSDT = Array.from({ length: 35 }, (_, i) => buyFill(i + 1, 100 + i, 0.001, 60, clock - (35 - i) * 3_600_000));
    // Las cinco mas viejas ya estaban, del archivo.
    await db.transactions.bulkPut(
      Array.from({ length: 5 }, (_, i) => manual({ id: `binance-${100 + i}`, date: "2026-10-19", type: "buy", amount: 60, quantity: 0.001 })),
    );
    await connect("2026-10-01");
    const r = await run();
    expect(r?.added).toBe(30);
    expect(calls("/api/v3/allOrders")).toBe(3);
  });

  it("si con las diez alcanza, no pide mas", async () => {
    fake.prices = { BTCUSDT: 60_000 };
    fake.balances = { BTC: 0.015 };
    fake.trades.BTCUSDT = Array.from({ length: 15 }, (_, i) => buyFill(i + 1, 100 + i, 0.001, 60, clock - (15 - i) * 3_600_000));
    // Las primeras doce ya estaban, importadas del archivo.
    await db.transactions.bulkPut(
      Array.from({ length: 12 }, (_, i) => manual({ id: `binance-${100 + i}`, date: "2026-10-20", type: "buy", amount: 60, quantity: 0.001 })),
    );
    await connect("2026-10-01");
    const r = await run();
    expect(r?.added).toBe(3);
    expect(calls("/api/v3/allOrders")).toBe(1);
  });

  it("una orden que vino del archivo no se reemplaza, aunque Binance la cuente distinta", async () => {
    fake.prices = { BTCUSDT: 60_000 };
    fake.balances = { BTC: 0.02 };
    fake.trades.BTCUSDT = [
      { id: 1, orderId: 5, qty: 0.01, quoteQty: 600, commission: 0.00001, commissionAsset: "BTC", time: clock - 2 * DAY, isBuyer: true },
      buyFill(2, 6, 0.01, 600, clock - DAY),
    ];
    const delArchivo = manual({ id: "binance-5", date: "2026-10-19", type: "buy", amount: 600, quantity: 0.01, price: 60_000, note: "del archivo" });
    await db.transactions.put(delArchivo);
    await connect("2026-10-01");
    await run();
    expect(await db.transactions.get("binance-5")).toEqual(delArchivo);
    expect(await db.transactions.get("binance-6")).toBeDefined();
  });

  it("una orden abierta se carga cuando termina, aunque se cancele a medias", async () => {
    fake.prices = { BTCUSDT: 60_000 };
    fake.balances = { BTC: 0.004, USDT: 600 };
    fake.locked = { USDT: 360 };
    fake.trades.BTCUSDT = [buyFill(1, 7, 0.004, 240, clock - 1000)];
    fake.orderStatus = { 7: "PARTIALLY_FILLED" };
    await connect("2026-10-01");
    await run();
    expect(await db.transactions.get("binance-7")).toBeUndefined();
    // Se cancela lo que faltaba: el total no cambia, lo bloqueado si.
    fake.orderStatus = { 7: "CANCELED" };
    fake.locked = {};
    later();
    await run();
    expect((await db.transactions.get("binance-7"))?.quantity).toBe(0.004);
  });

  it("Earn se carga una vez, cuando el mes termino", async () => {
    fake.rewards = [
      { asset: "USDT", rewards: 0.4, time: clock - 5 * DAY, type: "REALTIME" },
      { asset: "USDT", rewards: 0.3, time: clock - 4 * DAY, type: "BONUS" },
    ];
    await connect("2026-10-01");
    await run();
    expect(await db.transactions.get("binance-earn-USDT-2026-10")).toBeUndefined();
    clock = Date.parse("2026-11-05T12:00:00Z");
    await run();
    expect((await db.transactions.get("binance-earn-USDT-2026-10"))?.amount).toBeCloseTo(0.7, 10);
    // Un pago de octubre que Binance informa tarde ya no rearma el movimiento.
    fake.rewards.push({ asset: "USDT", rewards: 0.2, time: Date.parse("2026-10-30T12:00:00Z"), type: "REALTIME" });
    clock += 7 * 3_600_000;
    await run(true);
    expect((await db.transactions.get("binance-earn-USDT-2026-10"))?.amount).toBeCloseTo(0.7, 10);
  });

  it("lo borrado cuenta como cargado: no vuelve, y lo de antes tampoco se toca", async () => {
    fake.deposits = [
      { id: "d1", coin: "USDT", amount: 100, status: 1, insertTime: clock - 3 * DAY },
      { id: "d2", coin: "USDT", amount: 250, status: 1, insertTime: clock - DAY },
    ];
    await connect("2026-10-01");
    await run();
    await db.transactions.delete("binance-ing-d2");
    await forgetBinanceTx(db, "binance-ing-d2");
    later();
    await run(true);
    expect(await db.transactions.get("binance-ing-d2")).toBeUndefined();
    expect(await db.transactions.get("binance-ing-d1")).toBeDefined();
  });

  it("una cripto que ya no esta en la cuenta no se sale a buscar", async () => {
    // Comprada y vendida entera, sin saldo hoy y sin nada en Waltra: es el
    // precio de no revisar todos los pares.
    fake.prices = { SOLUSDT: 150 };
    fake.balances = { USDT: 1010 };
    fake.trades.SOLUSDT = [
      { id: 1, orderId: 1, qty: 2, quoteQty: 300, commission: 0, commissionAsset: "SOL", time: clock - 4 * DAY, isBuyer: true },
      { id: 2, orderId: 2, qty: 2, quoteQty: 310, commission: 0, commissionAsset: "USDT", time: clock - 3 * DAY, isBuyer: false },
    ];
    await connect("2026-10-01");
    await run();
    expect(calls("/api/v3/allOrders")).toBe(0);
  });
});

describe("las pasadas siguientes", () => {
  it("no duplican nada y, sin cambios de saldo, no miran ningun par", async () => {
    fake = demoFake(START);
    await connect("2026-09-01");
    await run();
    later();
    log.paths = [];
    const r = await run();
    expect(r).toMatchObject({ added: 0, dupes: 0 });
    expect(calls("/api/v3/allOrders")).toBe(0);
    expect(await db.transactions.count()).toBe(6);

    // Una compra nueva cambia el saldo de SOL: solo se mira su par.
    fake.prices.SOLUSDT = 150;
    fake.trades.SOLUSDT = [{ id: 1, orderId: 77, qty: 2, quoteQty: 300, commission: 0, commissionAsset: "SOL", time: clock, isBuyer: true }];
    fake.balances.SOL = 2;
    later();
    log.paths = [];
    expect((await run())?.added).toBe(1);
    expect(calls("/api/v3/allOrders")).toBe(1);
  });

  it("respetan el minimo entre pasadas", async () => {
    fake = demoFake(START);
    await connect("2026-09-01");
    await run();
    later(10_000);
    expect(await run()).toBeNull();
  });

  it("un ingreso pendiente se trae cuando se acredita", async () => {
    fake.deposits = [{ id: "d1", coin: "USDT", amount: 250, status: 0, insertTime: clock - 2 * DAY }];
    await connect("2026-10-01");
    await run();
    expect(await db.transactions.count()).toBe(0);
    fake.deposits[0].status = 1;
    later(DAY);
    await run();
    expect(await db.transactions.get("binance-ing-d1")).toBeDefined();
  });

  it("una pasada que falla no se come el cambio de saldo: la compra entra en la siguiente", async () => {
    fake.prices = { BTCUSDT: 60_000 };
    fake.balances = { BTC: 0.004, USDT: 1000 };
    fake.trades.BTCUSDT = [buyFill(1, 5, 0.004, 240, clock - DAY)];
    await connect("2026-10-01");
    await run();
    later(3_600_000);
    fake.trades.BTCUSDT.push(buyFill(2, 6, 0.001, 60, clock - 1000));
    fake.balances.BTC = 0.005;
    const base = fakeTransport(fake, { now, log });
    const conCorte: BinanceTransport = async (req) =>
      req.url.includes("/capital/deposit/hisrec") ? { status: 503, headers: {}, body: { code: -1001, msg: "x" } } : base(req);
    expect((await run(false, conCorte))?.error).toBeTruthy();
    later();
    await run();
    expect(await db.transactions.get("binance-6")).toBeDefined();
  });

  it("un historial largo que no entra en una pasada sigue para atras en la siguiente, sin perder nada", async () => {
    fake.withdrawals = [
      { id: "w-viejo", coin: "USDT", amount: 100, transactionFee: 1, status: 6, completeTime: START - 700 * DAY },
      { id: "w-nuevo", coin: "USDT", amount: 50, transactionFee: 1, status: 6, completeTime: START - 2 * DAY },
    ];
    await connect("2024-10-01");
    const primera = await run();
    expect(primera?.partial).toBe(true);
    expect(log.weight.uid).toBeLessThanOrEqual(120_000);
    let vueltas = 1;
    while ((await db.connections.get("binance"))?.lastRun?.partial && vueltas < 10) {
      later(61_000);
      await run();
      vueltas += 1;
    }
    expect(vueltas).toBeGreaterThan(1);
    expect(await db.transactions.get("binance-ret-w-nuevo")).toBeDefined();
    expect(await db.transactions.get("binance-ret-w-viejo")).toBeDefined();
  });

  it("muchas monedas: la cola sigue donde quedo hasta terminar, y despues no insiste", async () => {
    fake.prices = { BTCUSDT: 60_000 };
    fake.balances = { USDT: 1000 };
    for (let i = 0; i < 120; i++) {
      const c = `C${String(i).padStart(3, "0")}`;
      fake.prices[`${c}USDT`] = 1;
      fake.prices[`${c}BTC`] = 0.00001;
      fake.balances[c] = 0.5;
    }
    fake.trades.C119USDT = [{ id: 1, orderId: 4242, qty: 10, quoteQty: 10, commission: 0, commissionAsset: "C119", time: clock - DAY, isBuyer: true }];
    await connect("2026-10-15");
    const parciales: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      parciales.push(Boolean((await run())?.partial));
      later(65_000);
    }
    expect(await db.transactions.get("binance-4242")).toBeDefined();
    expect(parciales[0]).toBe(true);
    expect(parciales.slice(-2)).toEqual([false, false]);
    expect((await db.connections.get("binance"))?.queue).toEqual([]);
  });
});

describe("lo cargado a mano y lo borrado", () => {
  it("empareja con lo mas parecido y de la misma clase, no con cualquier cosa del mismo valor", async () => {
    fake.prices = { ETHUSDT: 3_000 };
    fake.balances = { USDT: 500, ETH: 0.17 };
    fake.deposits = [
      { id: "eth", coin: "ETH", amount: 0.17, status: 1, insertTime: clock - 1 * DAY },
      { id: "usdt", coin: "USDT", amount: 500, status: 1, insertTime: clock - 3 * DAY },
    ];
    await db.transactions.put(manual({ id: "a-mano", date: "2026-10-18", type: "deposit", amount: 500 }));
    await connect("2026-10-01");
    const r = await run();
    expect(r?.dupes).toBe(1);
    expect(await db.transactions.get("binance-ing-eth-c")).toBeDefined();
    expect(await db.transactions.get("binance-ing-usdt")).toBeUndefined();
    const { units, state } = await ledger();
    expect(units("ETH")).toBeCloseTo(0.17, 10);
    expect(state.cash.binance?.USD).toBeCloseTo(500, 6);
  });

  it("lo borrado no vuelve aunque se reconecte desde antes o se desconecte y conecte", async () => {
    fake.deposits = [{ id: "d1", coin: "USDT", amount: 250, status: 1, insertTime: clock - DAY }];
    await connect("2026-10-01");
    await run();
    await db.transactions.delete("binance-ing-d1");
    await forgetBinanceTx(db, "binance-ing-d1");
    later();
    await connect("2026-09-15");
    await run(true);
    expect(await db.transactions.get("binance-ing-d1")).toBeUndefined();
    await disconnectBinance(db);
    expect((await db.connections.get("binance"))?.apiKey).toBe("");
    later();
    expect(await run(true)).toBeNull();
    await connect("2026-09-01");
    later();
    await run(true);
    expect(await db.transactions.get("binance-ing-d1")).toBeUndefined();
  });

  it("cambiar de cuenta muda todo lo de Binance junto", async () => {
    fake = demoFake(START);
    await connect("2026-09-01", "binance");
    await run();
    later();
    await connect("2026-09-01", "cocos");
    await run(true);
    const txs = await db.transactions.toArray();
    expect(txs.filter((t) => t.id.startsWith("binance-")).every((t) => t.accountId === "cocos")).toBe(true);
    const { state } = await ledger();
    expect(state.cash.binance?.USD ?? 0).toBeCloseTo(0, 6);
    expect(state.cash.cocos?.USD).toBeCloseTo(fake.balances.USDT, 6);
  });

  it("avisa del ingreso estimado del archivo y lo reemplaza si se trae desde antes", async () => {
    fake = demoFake(START);
    await db.transactions.bulkPut([
      manual({ id: "binance-capital-importado", date: "2026-10-03", type: "deposit", amount: 1500 }),
      manual({ id: "binance-9101", date: "2026-10-09", type: "buy", quantity: 0.3, price: 3000, amount: 900 }),
    ]);
    const txs = await db.transactions.toArray();
    expect(connectWarnings(txs, "binance", "2026-09-01").estimate).toMatchObject({ replace: true, amount: 1500 });
    expect(connectWarnings(txs, "binance", "2026-10-05").estimate).toMatchObject({ replace: false, until: "2026-10-09" });
    expect(connectWarnings(txs, "binance", "2026-10-09").estimate).toBeUndefined();
    await connect("2026-09-01", "binance", true);
    await run();
    expect(await db.transactions.get("binance-capital-importado")).toBeUndefined();
    expect((await ledger()).state.netContributedUsd).toBeCloseTo(2200, 6);
  });
});

describe("cuando algo falla", () => {
  it("una clave borrada se avisa y no se reintenta sola", async () => {
    await connect("2026-10-01");
    fake.failWith = { status: 401, code: -2015, msg: "Invalid API-key" };
    expect((await run())?.error).toMatch(/no acepta la clave/);
    expect((await db.connections.get("binance"))?.authError).toBeTruthy();
    later();
    expect(await run()).toBeNull();
  });

  it("si Binance pide esperar, se espera lo que pidio, aun con «Traer ahora»", async () => {
    await connect("2026-10-01");
    fake.failWith = { status: 429, code: -1003, retryAfter: 600 };
    await run();
    expect((await db.connections.get("binance"))?.blockedUntil).toBe(START + 600_000);
    log.paths = [];
    later(15_000);
    expect(await run(true)).toBeNull();
    expect(log.paths).toEqual([]);
    fake.failWith = undefined;
    later(600_000);
    expect(await run()).not.toBeNull();
  });

  it("una clave de otra cuenta de Binance no sigue con lo de esta", async () => {
    await connect("2026-10-01");
    await run();
    fake.uid = 9999;
    later();
    expect((await run())?.error).toMatch(/otra cuenta de Binance/);
  });

  it("un historial que la cuenta no tiene no frena a los demas", async () => {
    fake.deposits = [{ id: "d1", coin: "USDT", amount: 250, status: 1, insertTime: clock - DAY }];
    fake.unavailable = ["/sapi/v1/c2c/orderMatch/listUserOrderHistory"];
    await connect("2026-10-01");
    const r = await run();
    expect(r?.skipped.some((s) => s.includes("P2P"))).toBe(true);
    expect(await db.transactions.get("binance-ing-d1")).toBeDefined();
  });

  it("un error de P2P que llega con HTTP 200 no se toma por un historial vacio", async () => {
    fake.p2p = [{ orderNumber: "p1", tradeType: "BUY", asset: "USDT", fiat: "ARS", amount: 10, totalPrice: 15_000,
      orderStatus: "COMPLETED", createTime: clock - DAY, commission: 0 }];
    await connect("2026-10-01");
    const base = fakeTransport(fake, { now, log });
    const conError: BinanceTransport = async (req) =>
      req.url.includes("/c2c/")
        ? { status: 200, headers: {}, body: { code: "000002", message: "Sistema ocupado", data: null, success: false } }
        : base(req);
    const r = await run(false, conError);
    expect(r?.skipped.some((s) => s.includes("Sistema ocupado"))).toBe(true);
    later();
    await run();
    expect(await db.transactions.get("binance-p2p-p1")).toBeDefined();
  });

  it("una moneda de Binance que se llama como un ETF entra como cripto, una sola vez", async () => {
    fake.prices.DIAUSDT = 0.5;
    fake.balances = { DIA: 100 };
    fake.deposits = [{ id: "d-dia", coin: "DIA", amount: 100, status: 1, insertTime: clock - 2 * DAY }];
    await connect("2026-10-15");
    await run();
    later(7 * 3_600_000);
    fake.deposits.push({ id: "d-dia-2", coin: "DIA", amount: 10, status: 1, insertTime: clock - 1000 });
    await run();
    const dia = (await db.assets.toArray()).filter((a) => a.symbol === "DIA");
    expect(dia).toHaveLength(1);
    expect(dia[0]).toMatchObject({ kind: "crypto", source: "binance", sourceSymbol: "DIAUSDT" });
  });
});
