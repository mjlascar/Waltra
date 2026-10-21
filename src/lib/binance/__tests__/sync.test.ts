import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WaltraDB, ensureSeeded } from "@/lib/db";
import { BinanceClient } from "../client";
import { demoFake, emptyFake, fakeTransport, type FakeBinance, type FakeLog } from "../fake";
import { connectBinance, connectWarnings, defaultSince, disconnectBinance, forgetBinanceTx, MIN_INTERVAL, runBinance } from "../sync";
import type { BinanceTransport } from "../client";
import { buildLedger } from "@/lib/engine/ledger";
import { FxTable } from "@/lib/engine/fx";
import type { Asset } from "@/lib/types";

const DAY = 86_400_000;
const START = Date.parse("2026-10-21T12:00:00Z");

let db: WaltraDB;
let clock: number;
let fake: FakeBinance;
let log: FakeLog;
let n = 0;

const now = () => clock;
const client = () => new BinanceClient({ apiKey: fake.apiKey, secret: fake.secret }, fakeTransport(fake, { now, log }), now);
const run = (force = false) => runBinance(db, client(), { now, force });
const later = (ms = MIN_INTERVAL + 1000) => {
  clock += ms;
};

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

  it("rechaza una clave que Binance no conoce", async () => {
    const error = await connectBinance(db, new BinanceClient({ apiKey: "otra", secret: fake.secret }, fakeTransport(fake, { now }), now), {
      apiKey: "otra", secret: fake.secret, accountId: "binance", since: "2026-10-01",
    });
    expect(error).toMatch(/no reconoce/);
  });

  it("un secreto mal copiado tambien es una clave que no sirve", async () => {
    const error = await connectBinance(db, new BinanceClient({ apiKey: fake.apiKey, secret: "mal" }, fakeTransport(fake, { now }), now), {
      apiKey: fake.apiKey, secret: "mal", accountId: "binance", since: "2026-10-01",
    });
    expect(error).toMatch(/no reconoce/);
  });

  it("propone traer desde el ultimo dia cargado en la cuenta", () => {
    const txs = [
      { accountId: "binance", date: "2026-09-02" },
      { accountId: "binance", date: "2026-10-03" },
      { accountId: "cocos", date: "2026-10-20" },
    ];
    expect(defaultSince(txs, "binance")).toBe("2026-10-03");
    expect(defaultSince(txs, "otra", "2026-10-21")).toBe("2026-07-23");
  });
});

describe("la primera pasada", () => {
  it("trae ingresos, ordenes, P2P, Convert y Earn, y las cuentas cierran", async () => {
    fake = demoFake(START);
    await connect("2026-09-01");
    const r = await run();
    expect(r?.error).toBeUndefined();
    expect(r?.partial).toBe(false);

    const { txs, units, state } = await ledger();
    const ids = txs.map((t) => t.id).sort();
    expect(ids).toEqual([
      "binance-9001",
      "binance-9101",
      "binance-cv-cv-demo-1",
      "binance-earn-USDT-2026-10",
      "binance-ing-dep-demo-1",
      "binance-p2p-p2p-demo-1",
      "binance-p2p-p2p-demo-1-c",
    ]);
    expect(units("BTC")).toBeCloseTo(0.00999, 10);
    expect(units("ETH")).toBeCloseTo(0.4997, 10);
    // 1500 USDT de afuera y 700 comprados por P2P; 600 en BTC, 900 en ETH,
    // 600 en ETH por Convert y 1 de Earn: lo mismo que dice el saldo.
    expect(state.cash.binance?.USD).toBeCloseTo(fake.balances.USDT, 6);
    expect(state.cash.binance?.ARS ?? 0).toBeCloseTo(0, 6);
    expect(state.netContributedUsd).toBeCloseTo(2200, 6);
    expect(units("BTC")).toBeCloseTo(fake.balances.BTC, 10);
    expect(units("ETH")).toBeCloseTo(fake.balances.ETH, 10);
  });

  it("lo anterior al punto de partida no se trae", async () => {
    fake = demoFake(START);
    // La orden de ETH es del 9; la de BTC y el ingreso, de antes.
    await connect("2026-10-09");
    await run();
    const ids = (await db.transactions.toArray()).map((t) => t.id);
    expect(ids).not.toContain("binance-9001");
    expect(ids).not.toContain("binance-ing-dep-demo-1");
    expect(ids).toContain("binance-9101");
  });

  it("los activos nuevos se crean como cripto de Binance, y los que ya estaban se usan", async () => {
    fake = demoFake(START);
    await db.assets.put({ id: "mi-btc", symbol: "BTC", name: "Bitcoin", kind: "crypto", currency: "USD", source: "binance", sourceSymbol: "BTCUSDT", precision: 8 });
    await connect("2026-09-01");
    const r = await run();
    expect(r?.newAssets).toBe(1);
    const btc = await db.transactions.get("binance-9001");
    expect(btc?.assetId).toBe("mi-btc");
    const eth = (await db.assets.toArray()).find((a) => a.symbol === "ETH");
    expect(eth).toMatchObject({ kind: "crypto", source: "binance", sourceSymbol: "ETHUSDT" });
  });
});

describe("las pasadas siguientes", () => {
  it("no duplican nada", async () => {
    fake = demoFake(START);
    await connect("2026-09-01");
    await run();
    later();
    const r = await run();
    expect(r).toMatchObject({ added: 0, updated: 0, dupes: 0 });
    expect(await db.transactions.count()).toBe(7);
  });

  it("respetan el minimo entre pasadas", async () => {
    fake = demoFake(START);
    await connect("2026-09-01");
    await run();
    later(10_000);
    expect(await run()).toBeNull();
  });

  it("si los saldos no cambiaron, no se pregunta par por par", async () => {
    fake = demoFake(START);
    await connect("2026-09-01");
    await run();
    later();
    log.paths = [];
    await run();
    expect(log.paths.filter((p) => p === "/api/v3/myTrades")).toHaveLength(0);

    // Una compra nueva cambia el saldo de SOL: solo se revisan sus pares.
    fake.trades.SOLUSDT = [{ id: 1, orderId: 77, qty: 2, quoteQty: 300, commission: 0, commissionAsset: "SOL", time: clock, isBuyer: true }];
    fake.balances.SOL = 2;
    later();
    log.paths = [];
    const r = await run();
    expect(r?.added).toBe(1);
    expect(log.paths.filter((p) => p === "/api/v3/myTrades")).toHaveLength(1);
  });

  it("una orden que se siguio ejecutando se rearma entera", async () => {
    fake.prices = { BTCUSDT: 60_000 };
    fake.balances = { BTC: 0.004 };
    fake.trades.BTCUSDT = [{ id: 1, orderId: 5, qty: 0.004, quoteQty: 240, commission: 0, commissionAsset: "BTC", time: clock - DAY, isBuyer: true }];
    await connect("2026-10-01");
    await run();
    expect((await db.transactions.get("binance-5"))?.quantity).toBe(0.004);

    fake.trades.BTCUSDT.push({ id: 2, orderId: 5, qty: 0.006, quoteQty: 360, commission: 0, commissionAsset: "BTC", time: clock, isBuyer: true });
    fake.balances.BTC = 0.01;
    later();
    const r = await run();
    expect(r).toMatchObject({ added: 0, updated: 1 });
    const tx = await db.transactions.get("binance-5");
    expect(tx?.quantity).toBe(0.01);
    expect(tx?.amount).toBe(600);
  });

  it("lo cargado a mano gana: no se suma dos veces", async () => {
    fake.deposits = [{ id: "d1", coin: "USDT", amount: 250, status: 1, insertTime: clock - DAY }];
    await db.transactions.put({
      id: "a-mano", date: "2026-10-20", type: "deposit", accountId: "binance", amount: 250, currency: "USD",
      createdAt: "2026-10-20T10:00:00Z", updatedAt: "2026-10-20T10:00:00Z",
    });
    await connect("2026-10-01");
    const r = await run();
    expect(r?.dupes).toBe(1);
    expect(await db.transactions.get("binance-ing-d1")).toBeUndefined();
  });

  it("lo que el usuario borro no vuelve", async () => {
    fake.deposits = [{ id: "d1", coin: "USDT", amount: 250, status: 1, insertTime: clock - DAY }];
    await connect("2026-10-01");
    await run();
    await db.transactions.delete("binance-ing-d1");
    await forgetBinanceTx(db, "binance-ing-d1");
    later();
    await run(true);
    expect(await db.transactions.get("binance-ing-d1")).toBeUndefined();
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

  it("el Earn del mes en curso se rearma con lo que va pagando", async () => {
    fake.rewards = [{ asset: "USDT", rewards: 0.4, time: clock - DAY, type: "REALTIME" }];
    await connect("2026-10-01");
    await run();
    expect((await db.transactions.get("binance-earn-USDT-2026-10"))?.amount).toBe(0.4);
    fake.rewards.push({ asset: "USDT", rewards: 0.3, time: clock + 3_600_000, type: "BONUS" });
    later(7 * 3_600_000);
    const r = await run();
    expect(r?.updated).toBe(1);
    expect((await db.transactions.get("binance-earn-USDT-2026-10"))?.amount).toBeCloseTo(0.7, 10);
  });
});

describe("cuando algo falla", () => {
  it("una clave borrada se avisa y no se reintenta sola", async () => {
    await connect("2026-10-01");
    fake.failWith = { status: 401, code: -2015, msg: "Invalid API-key" };
    const r = await run();
    expect(r?.error).toMatch(/no acepta la clave/);
    expect((await db.connections.get("binance"))?.authError).toBeTruthy();
    later();
    expect(await run()).toBeNull();
  });

  it("si Binance pide esperar, se espera lo que pidio", async () => {
    await connect("2026-10-01");
    fake.failWith = { status: 429, code: -1003, retryAfter: 600 };
    await run();
    expect((await db.connections.get("binance"))?.blockedUntil).toBe(START + 600_000);
    later();
    fake.failWith = undefined;
    expect(await run()).toBeNull();
    later(600_000);
    expect(await run()).not.toBeNull();
  });

  it("un historial que la cuenta no tiene no frena a los demas", async () => {
    fake.deposits = [{ id: "d1", coin: "USDT", amount: 250, status: 1, insertTime: clock - DAY }];
    fake.unavailable = ["/sapi/v1/c2c/orderMatch/listUserOrderHistory"];
    await connect("2026-10-01");
    const r = await run();
    expect(r?.skipped.some((s) => s.includes("P2P"))).toBe(true);
    expect(await db.transactions.get("binance-ing-d1")).toBeDefined();
  });

  it("un historial largo se trae en varias pasadas, sin pasarse del limite de Binance", async () => {
    fake.withdrawals = [
      { id: "w-viejo", coin: "USDT", amount: 100, transactionFee: 1, status: 6, completeTime: START - 700 * DAY },
      { id: "w-nuevo", coin: "USDT", amount: 50, transactionFee: 1, status: 6, completeTime: START - 2 * DAY },
    ];
    await connect("2024-10-01");
    const first = await run();
    expect(first?.partial).toBe(true);
    expect(log.weight.uid).toBeLessThanOrEqual(120_000);
    let vueltas = 1;
    while ((await db.connections.get("binance"))?.lastRun?.partial && vueltas < 10) {
      later(61_000);
      await run();
      vueltas += 1;
    }
    expect(vueltas).toBeGreaterThan(1);
    expect(await db.transactions.get("binance-ret-w-viejo")).toBeDefined();
    expect(await db.transactions.get("binance-ret-w-nuevo")).toBeDefined();
  });
});

describe("lo que encontró la revisión", () => {
  it("una pasada que falla no se come el cambio de saldo: la compra entra en la siguiente", async () => {
    fake.prices = { BTCUSDT: 60_000 };
    fake.balances = { BTC: 0.004, USDT: 1000 };
    fake.trades.BTCUSDT = [{ id: 1, orderId: 5, qty: 0.004, quoteQty: 240, commission: 0, commissionAsset: "BTC", time: clock - DAY, isBuyer: true }];
    await connect("2026-10-01");
    await run();
    later(3_600_000);
    fake.trades.BTCUSDT.push({ id: 2, orderId: 6, qty: 0.001, quoteQty: 60, commission: 0, commissionAsset: "BTC", time: clock - 1000, isBuyer: true });
    fake.balances.BTC = 0.005;
    fake.unavailable = undefined;
    const falla = fakeTransport(fake, { now, log });
    const conCorte: BinanceTransport = async (req) =>
      req.url.includes("/capital/deposit/hisrec") ? { status: 503, headers: {}, body: { code: -1001, msg: "x" } } : falla(req);
    const r1 = await runBinance(db, new BinanceClient({ apiKey: fake.apiKey, secret: fake.secret }, conCorte, now), { now });
    expect(r1?.error).toBeTruthy();
    later();
    await run();
    expect(await db.transactions.get("binance-6")).toBeDefined();
  });

  it("una cripto comprada y vendida entera antes de conectar se trae igual", async () => {
    fake.prices = { SOLUSDT: 150 };
    fake.balances = { USDT: 1010 };
    fake.deposits = [{ id: "d1", coin: "USDT", amount: 1000, status: 1, insertTime: clock - 5 * DAY }];
    fake.trades.SOLUSDT = [
      { id: 1, orderId: 1, qty: 2, quoteQty: 300, commission: 0, commissionAsset: "SOL", time: clock - 4 * DAY, isBuyer: true },
      { id: 2, orderId: 2, qty: 2, quoteQty: 310, commission: 0, commissionAsset: "USDT", time: clock - 3 * DAY, isBuyer: false },
    ];
    await connect("2026-10-01");
    await run();
    const { state } = await ledger();
    expect(state.cash.binance?.USD).toBeCloseTo(1010, 6);
    expect(state.realizedUsd).toBeCloseTo(10, 6);
  });

  it("una que se compró y se vendió después, si pasó una noche en la cuenta, la encuentra la revisión diaria", async () => {
    fake.prices = { SOLUSDT: 150 };
    fake.balances = { USDT: 1010 };
    await connect("2026-10-01");
    await run();
    fake.trades.SOLUSDT = [
      { id: 1, orderId: 1, qty: 2, quoteQty: 300, commission: 0, commissionAsset: "SOL", time: clock + 3_600_000, isBuyer: true },
      { id: 2, orderId: 2, qty: 2, quoteQty: 310, commission: 0, commissionAsset: "USDT", time: clock + 2 * DAY, isBuyer: false },
    ];
    fake.snapshots = [{ time: clock + DAY, balances: { SOL: 2, USDT: 710 } }];
    later(3 * DAY);
    await run();
    expect(await db.transactions.get("binance-2")).toBeDefined();
  });

  it("muchas monedas: la revisión completa sigue donde quedó hasta terminar, y después no insiste", async () => {
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
    for (let i = 0; i < 8; i++) {
      const r = await run();
      parciales.push(Boolean(r?.partial));
      later(65_000);
    }
    expect(await db.transactions.get("binance-4242")).toBeDefined();
    expect(parciales.slice(-2)).toEqual([false, false]);
    expect((await db.connections.get("binance"))?.queue).toEqual([]);
  });

  it("lo cargado a mano empareja con lo más parecido y de la misma clase, no con cualquier cosa del mismo valor", async () => {
    fake.prices = { ETHUSDT: 3_000 };
    fake.balances = { USDT: 500, ETH: 0.17 };
    fake.deposits = [
      { id: "eth", coin: "ETH", amount: 0.17, status: 1, insertTime: clock - 1 * DAY },
      { id: "usdt", coin: "USDT", amount: 500, status: 1, insertTime: clock - 3 * DAY },
    ];
    await db.transactions.put({
      id: "a-mano", date: "2026-10-18", type: "deposit", accountId: "binance", amount: 500, currency: "USD",
      createdAt: "2026-10-18T10:00:00Z", updatedAt: "2026-10-18T10:00:00Z",
    });
    await connect("2026-10-01");
    const r = await run();
    expect(r?.dupes).toBe(1);
    expect(await db.transactions.get("binance-ing-usdt")).toBeUndefined();
    expect(await db.transactions.get("binance-ing-eth-c")).toBeDefined();
    later(DAY);
    await run();
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

  it("una clave de otra cuenta de Binance no sigue con lo de esta", async () => {
    await connect("2026-10-01");
    await run();
    fake.uid = 9999;
    later();
    const r = await run();
    expect(r?.error).toMatch(/otra cuenta de Binance/);
  });

  it("ni «Traer ahora» le pregunta a Binance mientras pidió esperar", async () => {
    await connect("2026-10-01");
    fake.failWith = { status: 429, code: -1003, retryAfter: 600 };
    await run();
    log.paths = [];
    later(15_000);
    expect(await run(true)).toBeNull();
    expect(log.paths).toEqual([]);
  });

  it("un error de P2P que llega con HTTP 200 no se toma por un historial vacío", async () => {
    await connect("2026-10-01");
    const base = fakeTransport(fake, { now, log });
    const conError: BinanceTransport = async (req) =>
      req.url.includes("/c2c/")
        ? { status: 200, headers: {}, body: { code: "000002", message: "Sistema ocupado", data: null, success: false } }
        : base(req);
    const r = await runBinance(db, new BinanceClient({ apiKey: fake.apiKey, secret: fake.secret }, conError, now), { now });
    expect(r?.skipped.some((s) => s.includes("Sistema ocupado"))).toBe(true);
    expect((await db.connections.get("binance"))?.cursors.p2p).toBeUndefined();
  });

  it("una moneda de Binance que se llama como un ETF entra como cripto, una sola vez", async () => {
    fake.prices.DIAUSDT = 0.5;
    fake.balances = { DIA: 100 };
    fake.deposits = [{ id: "d-dia", coin: "DIA", amount: 100, status: 1, insertTime: clock - 2 * DAY }];
    fake.rewards = [{ asset: "DIA", rewards: 0.1, time: clock - DAY, type: "REALTIME" }];
    await connect("2026-10-15");
    await run();
    later(7 * 3_600_000);
    fake.rewards.push({ asset: "DIA", rewards: 0.1, time: clock - 1000, type: "REALTIME" });
    await run();
    const dia = (await db.assets.toArray()).filter((a) => a.symbol === "DIA");
    expect(dia).toHaveLength(1);
    expect(dia[0]).toMatchObject({ kind: "crypto", source: "binance", sourceSymbol: "DIAUSDT" });
  });

  it("avisa del ingreso estimado del archivo y lo reemplaza si se trae desde antes", async () => {
    fake = demoFake(START);
    const iso = "2026-10-01T00:00:00Z";
    await db.transactions.bulkPut([
      { id: "binance-capital-importado", date: "2026-10-03", type: "deposit", accountId: "binance", amount: 1500, currency: "USD", createdAt: iso, updatedAt: iso },
      { id: "binance-9101", date: "2026-10-09", type: "buy", accountId: "binance", quantity: 0.3, price: 3000, amount: 900, currency: "USD", createdAt: iso, updatedAt: iso },
    ]);
    const txs = await db.transactions.toArray();
    expect(connectWarnings(txs, "binance", "2026-09-01").estimate).toMatchObject({ replace: true, amount: 1500 });
    expect(connectWarnings(txs, "binance", "2026-10-05").estimate).toMatchObject({ replace: false, until: "2026-10-09" });
    expect(connectWarnings(txs, "binance", "2026-10-09").estimate).toBeUndefined();
    await connect("2026-09-01", "binance", true);
    await run();
    const { state } = await ledger();
    expect(await db.transactions.get("binance-capital-importado")).toBeUndefined();
    expect(state.netContributedUsd).toBeCloseTo(2200, 6);
  });
});
