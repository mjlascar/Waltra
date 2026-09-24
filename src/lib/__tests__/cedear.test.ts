import { describe, expect, it } from "vitest";
import {
  cedearOf,
  cedearSymbol,
  isUsListing,
  misloadedCedears,
  resolveTradeAsset,
  tradesAsCedear,
} from "@/lib/cedear";
import { computePortfolio } from "@/lib/engine/portfolio";
import { lookupCatalog } from "@/lib/catalog";
import type { Asset, Transaction } from "@/lib/types";

const spy = { ...lookupCatalog("SPY")!, id: "spy" } as Asset;

let n = 0;
const nuevoId = () => `nuevo-${++n}`;

function tx(fields: Partial<Transaction> & Pick<Transaction, "type" | "date" | "amount">): Transaction {
  return {
    id: `t${++n}`,
    accountId: "cocos",
    currency: "USD",
    createdAt: `2026-01-01T00:00:${String(n % 60).padStart(2, "0")}.000Z`,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...fields,
  };
}

describe("el caso real: 9 CEDEARs de SPY a $ 50.705", () => {
  /**
   * La primera compra real cargada en la app. Con 460.000 pesos ingresados y
   * un MEP de 1.450, se compraron 9 CEDEARs de SPY por 456.345 pesos.
   *
   * Registrados como acciones de SPY a US$ 660, la cartera pasaba a valer
   * casi US$ 6.000 con US$ 317 aportados. Registrados como lo que son, vale lo
   * que costó más lo que se movió el precio.
   */
  const fx = [{ date: "2026-02-20", arsPerUsd: 1450 }];
  const movimientos = (assetId: string) => [
    tx({ type: "deposit", date: "2026-02-20", amount: 460_000, currency: "ARS", accountId: "cocos" }),
    tx({
      type: "buy",
      date: "2026-02-25",
      amount: 456_345,
      currency: "ARS",
      assetId,
      quantity: 9,
      price: 50_705,
    }),
  ];
  const base = {
    accounts: [
      { id: "cocos", name: "Cocos Capital", broker: "cocos" as const, currency: "USD" as const, createdAt: "" },
    ],
    fxRates: fx,
    asOf: "2026-03-01",
  };

  it("como acción de EE.UU. inventa miles de dólares", () => {
    const p = computePortfolio({
      ...base,
      transactions: movimientos("spy"),
      assets: [spy],
      priceSeries: [],
      quotes: [{ assetId: "spy", price: 660, currency: "USD", at: "2026-03-01", source: "yahoo" }],
    });
    // Esto es el bug, fijado para que se entienda por qué existe la regla.
    expect(p.totalPnlUsd).toBeGreaterThan(5000);
  });

  it("como CEDEAR vale lo que costó", () => {
    const cedear = cedearOf(spy, "spy");
    const p = computePortfolio({
      ...base,
      transactions: movimientos("spy"),
      assets: [cedear],
      priceSeries: [],
      quotes: [{ assetId: "spy", price: 50_705, currency: "ARS", at: "2026-03-01", source: "byma" }],
    });
    expect(p.totalPnlUsd).toBeCloseTo(0, 6);
    expect(p.totalValueUsd).toBeCloseTo(460_000 / 1450, 4);
  });
});

describe("isUsListing", () => {
  it("reconoce la acción y el ETF de EE.UU.", () => {
    expect(isUsListing(spy)).toBe(true);
    expect(isUsListing({ ...spy, kind: "stock", symbol: "AAPL" })).toBe(true);
  });

  it("no confunde con lo que ya cotiza en BYMA", () => {
    expect(isUsListing(lookupCatalog("GGAL.BA")!)).toBe(false);
    expect(isUsListing(cedearOf(spy, "x"))).toBe(false);
  });

  it("la cripto no es una acción", () => {
    expect(isUsListing(lookupCatalog("BTC")!)).toBe(false);
  });
});

describe("cedearOf", () => {
  it("cotiza en pesos en BYMA con el sufijo de BYMA", () => {
    expect(cedearOf(spy, "x")).toMatchObject({
      symbol: "SPY.BA",
      kind: "cedear",
      currency: "ARS",
      source: "byma",
      sourceSymbol: "SPY.BA",
    });
  });

  it("dice que es un CEDEAR en el nombre, una sola vez", () => {
    const una = cedearOf(spy, "x");
    expect(una.name).toMatch(/\(CEDEAR\)$/);
    expect(cedearOf(una, "y").name.match(/CEDEAR/g)).toHaveLength(1);
  });

  it("no duplica el sufijo", () => {
    expect(cedearSymbol("SPY.BA")).toBe("SPY.BA");
    expect(cedearSymbol("spy")).toBe("SPY.BA");
  });
});

describe("resolveTradeAsset", () => {
  it("en pesos, SPY es su CEDEAR", () => {
    const r = resolveTradeAsset([], "SPY", "ARS", nuevoId);
    expect(r.cedear).toBe(true);
    expect(r.nuevo).toBe(true);
    expect(r.asset.symbol).toBe("SPY.BA");
  });

  it("en dólares, SPY sigue siendo la acción", () => {
    const r = resolveTradeAsset([], "SPY", "USD", nuevoId);
    expect(r.cedear).toBe(false);
    expect(r.asset.symbol).toBe("SPY");
  });

  it("no se deja llevar por la acción que ya está cargada", () => {
    // Exactamente el estado del teléfono después del bug: la acción existe.
    // Una compra nueva en pesos tiene que ir al CEDEAR igual.
    const r = resolveTradeAsset([spy], "SPY", "ARS", nuevoId);
    expect(r.asset.symbol).toBe("SPY.BA");
  });

  it("reusa el CEDEAR si ya existe", () => {
    const ya = cedearOf(spy, "cedear-spy");
    const r = resolveTradeAsset([spy, ya], "SPY", "ARS", nuevoId);
    expect(r).toMatchObject({ nuevo: false, cedear: true });
    expect(r.asset.id).toBe("cedear-spy");
  });

  it("respeta el activo elegido cuando no es una acción de EE.UU.", () => {
    const galicia = { ...lookupCatalog("GGAL.BA")!, id: "ggal" } as Asset;
    const r = resolveTradeAsset([galicia], "GGAL.BA", "ARS", nuevoId);
    expect(r).toMatchObject({ nuevo: false, cedear: false });
    expect(r.asset.id).toBe("ggal");
  });

  it("un símbolo desconocido sigue su camino de siempre", () => {
    const r = resolveTradeAsset([], "ZZZQ", "USD", nuevoId);
    expect(r.cedear).toBe(false);
    expect(r.asset.symbol).toBe("ZZZQ");
  });
});

const cuentas = [
  { id: "cocos", broker: "cocos" as const },
  { id: "ibkr", broker: "other" as const },
];

describe("misloadedCedears", () => {
  it("detecta la acción con compras en pesos", () => {
    const txs = [tx({ type: "buy", date: "2026-02-25", amount: 456_345, currency: "ARS", assetId: "spy", quantity: 9 })];
    expect(misloadedCedears([spy], txs, cuentas).map((a) => a.id)).toEqual(["spy"]);
  });

  it("deja en paz la acción comprada en dólares desde un broker del exterior", () => {
    const txs = [
      tx({ type: "buy", date: "2026-02-25", amount: 660, currency: "USD", assetId: "spy", quantity: 1, accountId: "ibkr" }),
    ];
    expect(misloadedCedears([spy], txs, cuentas)).toEqual([]);
  });

  it("con operaciones mezcladas no adivina", () => {
    const txs = [
      tx({ type: "buy", date: "2026-02-25", amount: 660, currency: "USD", assetId: "spy", quantity: 1, accountId: "ibkr" }),
      tx({ type: "buy", date: "2026-02-26", amount: 50_000, currency: "ARS", assetId: "spy", quantity: 1 }),
    ];
    expect(misloadedCedears([spy], txs, cuentas)).toEqual([]);
  });

  it("un activo sin operaciones no es sospechoso", () => {
    expect(misloadedCedears([spy], [], cuentas)).toEqual([]);
  });
});

describe("en Cocos, también en dólares", () => {
  /**
   * Desde un broker argentino se compran CEDEARs en dólares MEP (SPYD), pero
   * la acción de Nueva York no. Sin esta mitad de la regla, 9 CEDEARs de SPY
   * comprados con US$ 300 volvían a valuarse como 9 acciones de US$ 660.
   */
  it("la regla sabe qué broker es local", () => {
    expect(tradesAsCedear("ARS")).toBe(true);
    expect(tradesAsCedear("USD", "cocos")).toBe(true);
    expect(tradesAsCedear("USD", "other")).toBe(false);
    expect(tradesAsCedear("USD")).toBe(false);
  });

  it("SPY comprado en dólares desde Cocos es el CEDEAR", () => {
    const r = resolveTradeAsset([], "SPY", "USD", nuevoId, { broker: "cocos" });
    expect(r.cedear).toBe(true);
    expect(r.asset.symbol).toBe("SPY.BA");
  });

  it("SPY comprado en dólares desde un broker del exterior es la acción", () => {
    const r = resolveTradeAsset([], "SPY", "USD", nuevoId, { broker: "other" });
    expect(r.cedear).toBe(false);
    expect(r.asset.symbol).toBe("SPY");
  });

  it("detecta la acción comprada en dólares desde Cocos", () => {
    const txs = [
      tx({ type: "buy", date: "2026-02-25", amount: 300, currency: "USD", assetId: "spy", quantity: 9, accountId: "cocos" }),
    ];
    expect(misloadedCedears([spy], txs, cuentas).map((a) => a.id)).toEqual(["spy"]);
  });

  it("un CEDEAR comprado en dólares vale lo que costó, con el costo en pesos", () => {
    // 9 CEDEARs a US$ 33,33 con el dólar a 1.450: el CEDEAR cotiza $ 48.333.
    const cedear = cedearOf(spy, "spy");
    const p = computePortfolio({
      transactions: [
        tx({ type: "deposit", date: "2026-02-20", amount: 300, currency: "USD", accountId: "cocos" }),
        tx({ type: "buy", date: "2026-02-25", amount: 300, currency: "USD", assetId: "spy", quantity: 9, price: 300 / 9, accountId: "cocos" }),
      ],
      assets: [cedear],
      accounts: [{ id: "cocos", name: "Cocos Capital", broker: "cocos", currency: "USD", createdAt: "" }],
      priceSeries: [],
      quotes: [{ assetId: "spy", price: (300 / 9) * 1450, currency: "ARS", at: "2026-03-01", source: "byma" }],
      fxRates: [{ date: "2026-02-20", arsPerUsd: 1450 }],
      asOf: "2026-03-01",
    });
    expect(p.totalPnlUsd).toBeCloseTo(0, 6);
    expect(p.totalValueUsd).toBeCloseTo(300, 6);
    // El costo promedio se guarda en la moneda del CEDEAR, pesos, aunque se
    // haya pagado en dólares: mezclarlas daría un costo de "$ 33".
    expect(p.positions[0].avgCost).toBeCloseTo((300 / 9) * 1450, 4);
    expect(p.positions[0].avgCostUsd).toBeCloseTo(300 / 9, 6);
  });
});
