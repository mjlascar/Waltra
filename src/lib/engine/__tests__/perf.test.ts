import { describe, expect, it } from "vitest";
import { computePortfolio } from "@/lib/engine/portfolio";
import type { Asset, PriceSeries, Transaction } from "@/lib/types";
import { addDays } from "@/lib/date";

/**
 * El telefono destino es un Galaxy S10e (2019). El calculo diario se rehace en
 * cada cambio del estado, asi que tiene que ser rapido incluso con una cartera
 * larga: si acá tarda cientos de milisegundos, allá se siente.
 */
function bigPortfolio(years: number, assetCount: number) {
  const start = addDays(new Date().toISOString().slice(0, 10), -years * 365);
  const assets: Asset[] = [];
  const priceSeries: PriceSeries[] = [];
  const transactions: Transaction[] = [];

  for (let a = 0; a < assetCount; a++) {
    const id = `a${a}`;
    assets.push({
      id,
      symbol: `SYM${a}`,
      name: `Activo ${a}`,
      kind: "stock",
      currency: "USD",
      source: "yahoo",
      sourceSymbol: `SYM${a}`,
      precision: 6,
    });
    const points = [];
    let price = 100 + a;
    for (let d = 0; d < years * 365; d++) {
      price *= 1 + Math.sin(d / 30 + a) * 0.01;
      points.push({ date: addDays(start, d), close: Number(price.toFixed(2)) });
    }
    priceSeries.push({ assetId: id, currency: "USD", points, updatedAt: new Date().toISOString() });
  }

  // Un aporte mensual y una compra por mes, rotando entre los activos.
  let seq = 0;
  for (let m = 0; m < years * 12; m++) {
    const day = addDays(start, m * 30);
    seq += 1;
    transactions.push({
      id: `d${seq}`, date: day, type: "deposit", accountId: "cocos",
      amount: 300, currency: "USD",
      createdAt: `2020-01-01T00:00:${String(seq % 60).padStart(2, "0")}.000Z`,
      updatedAt: "",
    });
    seq += 1;
    const assetId = `a${m % assetCount}`;
    transactions.push({
      id: `b${seq}`, date: addDays(day, 1), type: "buy", accountId: "cocos",
      assetId, quantity: 2, price: 100, amount: 200, currency: "USD",
      createdAt: `2020-01-01T00:01:${String(seq % 60).padStart(2, "0")}.000Z`,
      updatedAt: "",
    });
  }

  return { assets, priceSeries, transactions };
}

describe("rendimiento del cálculo", () => {
  it("10 años y 20 activos se calculan en menos de 400 ms", () => {
    const { assets, priceSeries, transactions } = bigPortfolio(10, 20);
    const accounts = [
      { id: "cocos", name: "Cocos", broker: "cocos" as const, currency: "USD" as const, createdAt: "" },
    ];

    const t0 = performance.now();
    const p = computePortfolio({ transactions, assets, accounts, priceSeries, quotes: [], fxRates: [] });
    const ms = performance.now() - t0;

    expect(p.hasData).toBe(true);
    expect(p.daily.length).toBeGreaterThan(3000);
    expect(p.positions.length).toBe(20);
    // Margen amplio: en un S10e esto puede ser 3 o 4 veces mas lento que acá.
    expect(ms).toBeLessThan(400);
    console.log(`  10 años x 20 activos: ${ms.toFixed(0)} ms, ${p.daily.length} días`);
  });

  it("un caso normal (2 años, 6 activos) es instantáneo", () => {
    const { assets, priceSeries, transactions } = bigPortfolio(2, 6);
    const accounts = [
      { id: "cocos", name: "Cocos", broker: "cocos" as const, currency: "USD" as const, createdAt: "" },
    ];
    const t0 = performance.now();
    computePortfolio({ transactions, assets, accounts, priceSeries, quotes: [], fxRates: [] });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(80);
    console.log(`  2 años x 6 activos: ${ms.toFixed(0)} ms`);
  });
});
