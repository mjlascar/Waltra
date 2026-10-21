import { describe, expect, it } from "vitest";
import { hmacHex } from "../client";
import {
  convertGroup,
  depositGroup,
  earnGroup,
  orderGroup,
  ordersFromFills,
  p2pGroup,
  swap,
  withdrawalGroup,
  type Draft,
  type Group,
  type Mapped,
  type UsdPrice,
} from "../map";
import { buildLedger } from "@/lib/engine/ledger";
import { FxTable } from "@/lib/engine/fx";
import type { Asset, Transaction } from "@/lib/types";

const precios: Record<string, number> = { BTC: 60_000, ETH: 3_000, BNB: 600 };
const usd: UsdPrice = async (asset) => (asset in precios ? precios[asset] : null);
const AT = Date.parse("2026-10-14T15:00:00Z");

function drafts(m: Mapped | Draft[] | string): Draft[] {
  if (typeof m === "string") throw new Error(m);
  if (Array.isArray(m)) return m;
  if (!m || "skip" in m) throw new Error(m ? m.skip : "sin movimientos");
  return (m as Group).drafts;
}

/** Lo que el ledger de la app hace con esos movimientos: efectivo y unidades. */
function libro(ds: Draft[]) {
  const assets: Record<string, Asset> = {};
  const txs: Transaction[] = ds.map((d, i) => {
    if (d.symbol && !assets[d.symbol]) {
      assets[d.symbol] = {
        id: d.symbol, symbol: d.symbol, name: d.symbol, kind: "crypto", currency: "USD",
        source: "binance", sourceSymbol: `${d.symbol}USDT`, precision: 8,
      };
    }
    return {
      ...d, assetId: d.symbol, accountId: "binance", date: "2026-10-14",
      createdAt: new Date(d.at + i).toISOString(), updatedAt: "",
    } as Transaction;
  });
  const state = buildLedger(txs, assets, new FxTable([{ date: "2026-10-01", arsPerUsd: 1500 }], 0));
  const units = (s: string) => state.positions[s]?.quantity ?? 0;
  const cash = (c: "USD" | "ARS") => state.cash.binance?.[c] ?? 0;
  return { state, units, cash };
}

describe("la firma de los pedidos", () => {
  it("da lo mismo que el ejemplo de la documentacion de Binance", async () => {
    const secret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";
    const qs = "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";
    expect(await hmacHex(secret, qs)).toBe("c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71");
  });
});

describe("una orden spot", () => {
  it("una compra con la comision en lo comprado deja las unidades que llegaron", async () => {
    const [o] = ordersFromFills("BTC", "USDT", [
      { id: 1, orderId: 7, qty: 0.006, quoteQty: 360, commission: 0.000006, commissionAsset: "BTC", time: AT, isBuyer: true },
      { id: 2, orderId: 7, qty: 0.004, quoteQty: 240, commission: 0.000004, commissionAsset: "BTC", time: AT + 5, isBuyer: true },
    ]);
    const ds = drafts(await orderGroup(o, usd));
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ id: "binance-7", type: "buy", symbol: "BTC", currency: "USD", note: "Binance BTC/USDT" });
    expect(ds[0].quantity).toBeCloseTo(0.00999, 10);
    expect(ds[0].price).toBeCloseTo(60_000, 6);
    const { units, cash } = libro(ds);
    expect(units("BTC")).toBeCloseTo(0.00999, 10);
    // Lo que salio de la cuenta es exactamente lo que cobro Binance.
    expect(cash("USD")).toBeCloseTo(-600, 8);
  });

  it("una venta con la comision en dolares cobra el neto", async () => {
    const [o] = ordersFromFills("ETH", "FDUSD", [
      { id: 3, orderId: 8, qty: 0.5, quoteQty: 1500, commission: 1.5, commissionAsset: "FDUSD", time: AT, isBuyer: false },
    ]);
    const ds = drafts(await orderGroup(o, usd));
    expect(ds[0]).toMatchObject({ type: "sell", symbol: "ETH", quantity: 0.5, amount: 1500, fee: 1.5 });
    const { units, cash } = libro([...drafts(await swap({ id: "x", at: AT - 10, note: "" }, { asset: "USDT", amount: 1500 }, { asset: "ETH", amount: 0.5 }, [], usd)), ...ds]);
    expect(units("ETH")).toBeCloseTo(0, 12);
    expect(cash("USD")).toBeCloseTo(-1.5, 8);
  });

  it("la comision en BNB descuenta BNB, no dolares", async () => {
    const [o] = ordersFromFills("BTC", "USDT", [
      { id: 4, orderId: 9, qty: 0.01, quoteQty: 600, commission: 0.001, commissionAsset: "BNB", time: AT, isBuyer: true },
    ]);
    const ds = drafts(await orderGroup(o, usd));
    expect(ds.map((d) => d.type)).toEqual(["buy", "adjust"]);
    expect(ds[1]).toMatchObject({ id: "binance-9-com-BNB", symbol: "BNB", quantity: -0.001, amount: 0.6 });
    expect(ds[0].quantity).toBe(0.01);
  });

  it("ETH contra BTC son una venta de BTC y una compra de ETH por lo mismo", async () => {
    const [o] = ordersFromFills("ETH", "BTC", [
      { id: 5, orderId: 10, qty: 1, quoteQty: 0.05, commission: 0.001, commissionAsset: "ETH", time: AT, isBuyer: true },
    ]);
    const ds = drafts(await orderGroup(o, usd));
    expect(ds.map((d) => [d.type, d.symbol, d.id])).toEqual([
      ["sell", "BTC", "binance-10-v"],
      ["buy", "ETH", "binance-10"],
    ]);
    expect(ds[0].amount).toBeCloseTo(3000, 6);
    expect(ds[1].quantity).toBeCloseTo(0.999, 10);
    const { units, cash } = libro([
      ...drafts(await swap({ id: "base", at: AT - 10, note: "" }, { asset: "USDT", amount: 3000 }, { asset: "BTC", amount: 0.05 }, [], usd)),
      ...ds,
    ]);
    expect(units("BTC")).toBeCloseTo(0, 12);
    expect(units("ETH")).toBeCloseTo(0.999, 10);
    // El efectivo no se mueve: es cripto contra cripto.
    expect(cash("USD")).toBeCloseTo(-3000, 8);
  });

  it("comprar USDT con pesos es un cambio de moneda, al dolar que se pago", async () => {
    const [o] = ordersFromFills("USDT", "ARS", [
      { id: 6, orderId: 11, qty: 100, quoteQty: 150_000, commission: 0.1, commissionAsset: "USDT", time: AT, isBuyer: true },
    ]);
    const ds = drafts(await orderGroup(o, usd));
    expect(ds[0]).toMatchObject({ type: "exchange", amount: 150_000, currency: "ARS", toAmount: 99.9, toCurrency: "USD" });
    expect(ds[0].fxRate).toBeCloseTo(1501.5, 1);
  });

  it("un dolar estable por otro no es nada que Waltra lleve", async () => {
    expect(await swap({ id: "x", at: AT, note: "" }, { asset: "USDT", amount: 10 }, { asset: "FDUSD", amount: 10 }, [], usd)).toEqual([]);
  });

  it("salvo la comision en BNB, que si son unidades que se fueron", async () => {
    const [o] = ordersFromFills("FDUSD", "USDT", [
      { id: 8, orderId: 13, qty: 1000, quoteQty: 999.5, commission: 0.002, commissionAsset: "BNB", time: AT, isBuyer: true },
    ]);
    const ds = drafts(await orderGroup(o, usd));
    expect(ds).toEqual([expect.objectContaining({ type: "adjust", symbol: "BNB", quantity: -0.002 })]);
  });

  it("una moneda que Waltra no lleva se informa en vez de inventarse", async () => {
    const [o] = ordersFromFills("BTC", "EUR", [
      { id: 7, orderId: 12, qty: 0.01, quoteQty: 550, commission: 0, commissionAsset: "BTC", time: AT, isBuyer: true },
    ]);
    const m = await orderGroup(o, usd);
    expect(m && "skip" in m && m.skip).toMatch(/no lleva EUR/);
  });
});

describe("Convert", () => {
  it("de USDT a una cripto es una compra", async () => {
    const ds = drafts(await convertGroup({ orderId: "c1", from: "USDT", fromAmount: 600, to: "ETH", toAmount: 0.2, status: "SUCCESS", time: AT }, usd));
    expect(ds[0]).toMatchObject({ id: "binance-cv-c1", type: "buy", symbol: "ETH", quantity: 0.2, amount: 600 });
  });

  it("uno que no termino no se registra", async () => {
    expect(await convertGroup({ orderId: "c2", from: "USDT", fromAmount: 1, to: "ETH", toAmount: 1, status: "PROCESS", time: AT }, usd)).toBeNull();
  });
});

describe("lo que entra y sale de otras billeteras", () => {
  it("USDT que llega es capital", async () => {
    const ds = drafts(await depositGroup({ id: "d1", coin: "USDT", amount: 250, status: 1, time: AT }, usd));
    expect(ds).toEqual([expect.objectContaining({ id: "binance-ing-d1", type: "deposit", amount: 250, currency: "USD" })]);
  });

  it("una cripto que llega es capital por lo que valia, y queda con ese costo", async () => {
    const ds = drafts(await depositGroup({ id: "d2", coin: "ETH", amount: 0.5, status: 1, time: AT }, usd));
    expect(ds.map((d) => d.type)).toEqual(["deposit", "buy"]);
    const { state, units, cash } = libro(ds);
    expect(units("ETH")).toBe(0.5);
    expect(cash("USD")).toBeCloseTo(0, 8);
    expect(state.netContributedUsd).toBeCloseTo(1500, 6);
  });

  it("un ingreso pendiente todavia no cuenta", async () => {
    expect(await depositGroup({ id: "d3", coin: "USDT", amount: 1, status: 0, time: AT }, usd)).toBeNull();
  });

  it("una cripto que se va es una venta y un retiro: la ganancia de aca queda contada", async () => {
    const compra = drafts(await swap({ id: "b", at: AT - 1000, note: "" }, { asset: "USDT", amount: 1000 }, { asset: "ETH", amount: 0.5 }, [], usd));
    const ds = drafts(await withdrawalGroup({ id: "w1", coin: "ETH", amount: 0.499, fee: 0.001, status: 6, time: AT }, usd));
    expect(ds.map((d) => [d.type, d.id])).toEqual([["sell", "binance-ret-w1-v"], ["withdraw", "binance-ret-w1"]]);
    const { state, units, cash } = libro([...compra, ...ds]);
    expect(units("ETH")).toBeCloseTo(0, 12);
    expect(cash("USD")).toBeCloseTo(-1000, 6);
    // Se compro a 2000 y se fue valiendo 3000: los 500 de ganancia son de aca.
    expect(state.realizedUsd).toBeCloseTo(500, 6);
    expect(state.netContributedUsd).toBeCloseTo(-1497, 6);
  });
});

describe("P2P", () => {
  it("comprar USDT con pesos: entran pesos de afuera y se cambian en el momento", async () => {
    const ds = drafts(await p2pGroup({ orderNumber: "p1", side: "BUY", asset: "USDT", fiat: "ARS", amount: 700, total: 1_050_000, fee: 0, status: "COMPLETED", time: AT }, usd));
    expect(ds.map((d) => d.type)).toEqual(["deposit", "exchange"]);
    const { cash, state } = libro(ds);
    expect(cash("ARS")).toBeCloseTo(0, 6);
    expect(cash("USD")).toBeCloseTo(700, 6);
    // El capital son los pesos que se pagaron, pasados al dolar del dia.
    expect(state.netContributedUsd).toBeCloseTo(700, 6);
  });

  it("vender USDT por pesos: se cambian y salen", async () => {
    const ds = drafts(await p2pGroup({ orderNumber: "p2", side: "SELL", asset: "USDT", fiat: "ARS", amount: 100, total: 152_000, fee: 0.05, status: "COMPLETED", time: AT }, usd));
    expect(ds.map((d) => d.type)).toEqual(["exchange", "withdraw"]);
    const { cash } = libro(ds);
    expect(cash("ARS")).toBeCloseTo(0, 6);
    expect(cash("USD")).toBeCloseTo(-100.05, 6);
  });

  it("una orden cancelada no se registra", async () => {
    expect(await p2pGroup({ orderNumber: "p3", side: "BUY", asset: "USDT", fiat: "ARS", amount: 1, total: 1, fee: 0, status: "CANCELLED", time: AT }, usd)).toBeNull();
  });
});

describe("Earn", () => {
  it("en dolares estables es un interes cobrado, uno por mes", () => {
    const ds = drafts(earnGroup("USDT", "2026-10", { units: 1.25, value: 0, last: AT }));
    expect(ds[0]).toMatchObject({ id: "binance-earn-USDT-2026-10", type: "interest", amount: 1.25, currency: "USD", note: "Earn de USDT, octubre de 2026" });
  });

  it("en cripto son unidades que entran como ingreso", () => {
    const g = earnGroup("ETH", "2026-09", { units: 0.001, value: 3, last: AT });
    expect(g && "drafts" in g && g.upsert).toBe(true);
    const { units, state } = libro(drafts(g));
    expect(units("ETH")).toBe(0.001);
    expect(state.incomeUsd).toBeCloseTo(3, 8);
  });
});
