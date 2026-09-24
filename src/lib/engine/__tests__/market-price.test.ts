import { describe, expect, it } from "vitest";
import { marketPriceOn } from "@/lib/engine/market-price";
import { computePortfolio } from "@/lib/engine/portfolio";
import type { Asset, PriceSeries, Transaction } from "@/lib/types";

/**
 * El caso que motivo esto: pesos ingresados hace meses, una compra de SPY ese
 * mismo dia y otra hoy. La de hoy no puede dar rendimiento: si las unidades
 * salen de la cotizacion de hoy, la cartera vale lo mismo antes y despues.
 */
const spy: Asset = {
  id: "spy",
  symbol: "SPY.BA",
  name: "SPDR S&P 500 (CEDEAR)",
  kind: "cedear",
  currency: "ARS",
  source: "byma",
  sourceSymbol: "SPY.BA",
  precision: 2,
};

const HOY = "2026-09-24";
const serie: PriceSeries = {
  assetId: "spy",
  currency: "ARS",
  // Viernes 18 y lunes 21; el fin de semana no hay cierre.
  points: [
    { date: "2026-03-02", close: 40_000 },
    { date: "2026-09-18", close: 49_000 },
    { date: "2026-09-21", close: 49_500 },
  ],
  updatedAt: "",
};
const quotes = [{ assetId: "spy", price: 50_000, currency: "ARS" as const, at: HOY, source: "byma" as const }];
const fxRates = [
  { date: "2026-03-02", arsPerUsd: 1_200 },
  { date: "2026-09-20", arsPerUsd: 1_500 },
];
const base = { asset: spy, today: HOY, quotes, priceSeries: [serie], fxRates };

describe("marketPriceOn", () => {
  it("hoy es la cotización en vivo, que es la que usa la valuación", () => {
    expect(marketPriceOn({ ...base, day: HOY, currency: "ARS" })).toMatchObject({ price: 50_000, live: true });
  });

  it("un día sin rueda toma el último cierre", () => {
    expect(marketPriceOn({ ...base, day: "2026-09-20", currency: "ARS" })).toMatchObject({
      price: 49_000,
      day: "2026-09-18",
      live: false,
    });
  });

  it("más de una semana sin cierre no es la cotización de ese día", () => {
    expect(marketPriceOn({ ...base, day: "2026-06-01", currency: "ARS" })).toBeNull();
  });

  it("en dólares, con el dólar de ese día", () => {
    expect(marketPriceOn({ ...base, day: "2026-03-02", currency: "USD" })!.price).toBeCloseTo(40_000 / 1_200, 6);
    expect(marketPriceOn({ ...base, day: HOY, currency: "USD" })!.price).toBeCloseTo(50_000 / 1_500, 6);
  });

  it("sin dólar no inventa una conversión", () => {
    expect(marketPriceOn({ ...base, fxRates: [], day: HOY, currency: "USD" })).toBeNull();
  });

  it("deshace el ajuste de un split posterior: es el precio en las unidades de ese día", () => {
    const r = marketPriceOn({
      ...base,
      day: "2026-03-02",
      currency: "ARS",
      splits: [{ date: "2026-06-10", ratio: 2.5, source: "proveedor", adjusted: true }],
    });
    expect(r!.price).toBeCloseTo(100_000, 6);
  });
});

describe("una compra de hoy a la cotización de hoy", () => {
  let n = 0;
  const tx = (f: Partial<Transaction> & Pick<Transaction, "type" | "date" | "amount">): Transaction => ({
    id: `t${++n}`,
    accountId: "cocos",
    currency: "ARS",
    createdAt: `2026-01-01T00:00:${String(n).padStart(2, "0")}.000Z`,
    updatedAt: "",
    ...f,
  });
  const correr = (transactions: Transaction[]) =>
    computePortfolio({
      transactions,
      assets: [spy],
      accounts: [{ id: "cocos", name: "Cocos", broker: "cocos", currency: "USD", createdAt: "" }],
      priceSeries: [serie],
      quotes,
      fxRates,
      asOf: HOY,
    });

  const antes = [
    tx({ type: "deposit", date: "2026-03-02", amount: 900_000 }),
    tx({ type: "buy", date: "2026-03-02", amount: 450_000, assetId: "spy", quantity: 450_000 / 40_000, price: 40_000 }),
  ];

  it("no mueve el valor ni la ganancia", () => {
    const precio = marketPriceOn({ ...base, day: HOY, currency: "ARS" })!.price;
    const despues = [
      ...antes,
      tx({ type: "buy", date: HOY, amount: 450_000, assetId: "spy", quantity: 450_000 / precio, price: precio }),
    ];
    const a = correr(antes);
    const d = correr(despues);
    expect(d.totalValueUsd).toBeCloseTo(a.totalValueUsd, 6);
    expect(d.totalPnlUsd).toBeCloseTo(a.totalPnlUsd, 6);
  });

  it("con el precio de otro día, la diferencia aparece como ganancia en el acto", () => {
    // Esto es lo que pasaba: las unidades salían de un precio viejo.
    const despues = [
      ...antes,
      tx({ type: "buy", date: HOY, amount: 450_000, assetId: "spy", quantity: 450_000 / 40_000, price: 40_000 }),
    ];
    const salto = correr(despues).totalPnlUsd - correr(antes).totalPnlUsd;
    expect(salto).toBeCloseTo(((450_000 / 40_000) * 50_000 - 450_000) / 1_500, 6);
  });
});
