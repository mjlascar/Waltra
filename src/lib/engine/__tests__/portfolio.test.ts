import { describe, expect, it } from "vitest";
import { computePortfolio } from "@/lib/engine/portfolio";
import { asset, binance, cocos, series, tx } from "./helpers";

const assets = [asset("qqq"), asset("btc", { kind: "crypto", source: "binance", precision: 8 })];

describe("computePortfolio", () => {
  it("un deposito es capital, no ganancia", () => {
    const p = computePortfolio({
      transactions: [tx("deposit", "2024-01-01", { amount: 100 })],
      assets,
      accounts: [cocos],
      priceSeries: [],
      quotes: [],
      fxRates: [],
      asOf: "2024-01-10",
    });
    expect(p.totalValueUsd).toBeCloseTo(100);
    expect(p.netContributedUsd).toBeCloseTo(100);
    expect(p.cashUsd).toBeCloseTo(100);
    expect(p.totalPnlUsd).toBeCloseTo(0);
    expect(p.metrics.twrCumulative).toBeCloseTo(0);
  });

  it("valua una compra al precio de mercado actual", () => {
    const p = computePortfolio({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 100 }),
        tx("buy", "2024-01-02", { amount: 50, assetId: "qqq", quantity: 0.1, price: 500 }),
      ],
      assets,
      accounts: [cocos],
      priceSeries: [series("qqq", "2024-01-01", 10, 500)],
      quotes: [
        { assetId: "qqq", price: 700, currency: "USD", at: "2024-01-10", source: "yahoo" },
      ],
      fxRates: [],
      asOf: "2024-01-10",
    });
    expect(p.cashUsd).toBeCloseTo(50);
    expect(p.investedUsd).toBeCloseTo(70); // 0.1 * 700
    expect(p.totalValueUsd).toBeCloseTo(120);
    expect(p.totalPnlUsd).toBeCloseTo(20);
    const qqq = p.positions[0];
    expect(qqq.avgCost).toBeCloseTo(500);
    expect(qqq.unrealizedUsd).toBeCloseTo(20);
    expect(qqq.unrealizedPct).toBeCloseTo(0.4);
  });

  it("la comision entra en el costo y baja el efectivo", () => {
    const p = computePortfolio({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 1000 }),
        tx("buy", "2024-01-02", {
          amount: 500,
          assetId: "qqq",
          quantity: 1,
          price: 500,
          fee: 10,
        }),
      ],
      assets,
      accounts: [cocos],
      priceSeries: [series("qqq", "2024-01-01", 10, 500)],
      quotes: [],
      fxRates: [],
      asOf: "2024-01-10",
    });
    expect(p.cashUsd).toBeCloseTo(490);
    expect(p.positions[0].avgCost).toBeCloseTo(510);
    expect(p.feesUsd).toBeCloseTo(10);
    expect(p.totalValueUsd).toBeCloseTo(990); // 490 efectivo + 500 valuado
  });

  it("una venta realiza resultado contra el costo promedio", () => {
    const p = computePortfolio({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 1000 }),
        tx("buy", "2024-01-02", { amount: 500, assetId: "qqq", quantity: 1, price: 500 }),
        tx("sell", "2024-01-05", { amount: 700, assetId: "qqq", quantity: 1, price: 700 }),
      ],
      assets,
      accounts: [cocos],
      priceSeries: [series("qqq", "2024-01-01", 10, 700)],
      quotes: [],
      fxRates: [],
      asOf: "2024-01-10",
    });
    expect(p.realizedUsd).toBeCloseTo(200);
    expect(p.positions.length).toBe(0);
    expect(p.totalValueUsd).toBeCloseTo(1200);
    expect(p.totalPnlUsd).toBeCloseTo(200);
  });

  it("separa el capital aportado del valor en la serie diaria", () => {
    const p = computePortfolio({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 100 }),
        tx("deposit", "2024-01-05", { amount: 100 }),
      ],
      assets,
      accounts: [cocos],
      priceSeries: [],
      quotes: [],
      fxRates: [],
      asOf: "2024-01-06",
    });
    expect(p.contributions.at(-1)!.value).toBeCloseTo(200);
    expect(p.daily.at(-1)!.nav).toBeCloseTo(200);
    // El valor subio 100% pero el usuario no gano nada: TWR = 0.
    expect(p.metrics.twrCumulative).toBeCloseTo(0);
    expect(p.totalPnlUsd).toBeCloseTo(0);
  });

  it("el TWR ignora el momento del aporte y mide solo el rendimiento", () => {
    // Compra 1 unidad a 100 el dia 1. El precio sube a 200 el dia 3.
    // El dia 3 inyecta 200 mas de capital.  El rendimiento real es +100%.
    const prices = series("qqq", "2024-01-01", 6, (i) => (i < 2 ? 100 : 200));
    const p = computePortfolio({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 100 }),
        tx("buy", "2024-01-01", { amount: 100, assetId: "qqq", quantity: 1, price: 100 }),
        tx("deposit", "2024-01-03", { amount: 200 }),
      ],
      assets,
      accounts: [cocos],
      priceSeries: [prices],
      quotes: [],
      fxRates: [],
      asOf: "2024-01-06",
    });
    expect(p.totalValueUsd).toBeCloseTo(400); // 200 en QQQ + 200 en efectivo
    expect(p.netContributedUsd).toBeCloseTo(300);
    expect(p.totalPnlUsd).toBeCloseTo(100);
    expect(p.metrics.twrCumulative).toBeCloseTo(1.0, 4);
    // El retorno simple sobre capital lo diluye: 100/300 = 33%.
    expect(p.simpleReturn).toBeCloseTo(1 / 3, 4);
  });

  it("convierte pesos a dolares con el tipo de cambio de la operacion", () => {
    const p = computePortfolio({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 100_000, currency: "ARS", fxRate: 1000 }),
      ],
      assets,
      accounts: [cocos],
      priceSeries: [],
      quotes: [],
      fxRates: [{ date: "2024-01-01", arsPerUsd: 1000 }, { date: "2024-01-10", arsPerUsd: 1250 }],
      asOf: "2024-01-10",
    });
    expect(p.netContributedUsd).toBeCloseTo(100); // 100.000 ARS a 1000
    // Los pesos quedaron quietos mientras el dolar subio 25%: se perdio valor.
    expect(p.totalValueUsd).toBeCloseTo(80);
    expect(p.totalPnlUsd).toBeCloseTo(-20);
  });

  it("reparte el valor entre cuentas", () => {
    const p = computePortfolio({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 100, accountId: "cocos" }),
        tx("deposit", "2024-01-01", { amount: 300, accountId: "binance" }),
        tx("buy", "2024-01-02", {
          amount: 300,
          accountId: "binance",
          assetId: "btc",
          quantity: 0.003,
          price: 100_000,
        }),
      ],
      assets,
      accounts: [cocos, binance],
      priceSeries: [series("btc", "2024-01-01", 10, 100_000)],
      quotes: [
        { assetId: "btc", price: 120_000, currency: "USD", at: "2024-01-10", source: "binance" },
      ],
      fxRates: [],
      asOf: "2024-01-10",
    });
    const byId = Object.fromEntries(p.accountViews.map((a) => [a.accountId, a]));
    expect(byId.cocos.valueUsd).toBeCloseTo(100);
    expect(byId.cocos.pnlUsd).toBeCloseTo(0);
    expect(byId.binance.valueUsd).toBeCloseTo(360);
    expect(byId.binance.pnlUsd).toBeCloseTo(60);
    expect(byId.binance.pnlPct).toBeCloseTo(0.2);
  });

  it("una transferencia entre cuentas no crea capital", () => {
    const p = computePortfolio({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 500, accountId: "cocos" }),
        tx("transfer", "2024-01-03", {
          amount: 200,
          accountId: "cocos",
          counterAccountId: "binance",
        }),
      ],
      assets,
      accounts: [cocos, binance],
      priceSeries: [],
      quotes: [],
      fxRates: [],
      asOf: "2024-01-10",
    });
    expect(p.netContributedUsd).toBeCloseTo(500);
    expect(p.totalValueUsd).toBeCloseTo(500);
    const byId = Object.fromEntries(p.accountViews.map((a) => [a.accountId, a]));
    expect(byId.cocos.cashUsd).toBeCloseTo(300);
    expect(byId.binance.cashUsd).toBeCloseTo(200);
    expect(byId.binance.pnlUsd).toBeCloseTo(0);
  });

  it("los dividendos cuentan como ganancia, no como aporte", () => {
    const p = computePortfolio({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 1000 }),
        tx("buy", "2024-01-02", { amount: 1000, assetId: "qqq", quantity: 2, price: 500 }),
        tx("dividend", "2024-01-05", { amount: 30, assetId: "qqq" }),
      ],
      assets,
      accounts: [cocos],
      priceSeries: [series("qqq", "2024-01-01", 10, 500)],
      quotes: [],
      fxRates: [],
      asOf: "2024-01-10",
    });
    expect(p.netContributedUsd).toBeCloseTo(1000);
    expect(p.incomeUsd).toBeCloseTo(30);
    expect(p.totalValueUsd).toBeCloseTo(1030);
    expect(p.totalPnlUsd).toBeCloseTo(30);
  });

  it("no inventa precios: avisa cuando falta cotizacion", () => {
    const p = computePortfolio({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 500 }),
        tx("buy", "2024-01-02", { amount: 500, assetId: "qqq", quantity: 1, price: 500 }),
      ],
      assets,
      accounts: [cocos],
      priceSeries: [],
      quotes: [],
      fxRates: [],
      asOf: "2024-01-10",
    });
    expect(p.missingPrices).toEqual(["QQQ"]);
    expect(p.positions[0].priceMissing).toBe(true);
    expect(p.totalValueUsd).toBeCloseTo(500); // valuado al costo
  });

  it("cartera vacia no rompe", () => {
    const p = computePortfolio({
      transactions: [],
      assets,
      accounts: [cocos],
      priceSeries: [],
      quotes: [],
      fxRates: [],
    });
    expect(p.hasData).toBe(false);
    expect(p.totalValueUsd).toBe(0);
    expect(p.positions).toEqual([]);
  });
});

describe("sin cotización del dólar", () => {
  it("no cuenta los pesos como si fueran dólares", () => {
    const p = computePortfolio({
      // 100.000 pesos: si se contaran uno a uno serían US$ 100.000.
      transactions: [tx("deposit", "2024-01-01", { amount: 100_000, currency: "ARS" })],
      assets,
      accounts: [cocos],
      priceSeries: [],
      quotes: [],
      fxRates: [],
      asOf: "2024-01-10",
    });
    expect(p.fxMissing).toBe(true);
    expect(p.totalValueUsd).toBe(0);
    expect(p.netContributedUsd).toBe(0);
  });

  it("no avisa si la operación trae su propio tipo de cambio", () => {
    const p = computePortfolio({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 100_000, currency: "ARS", fxRate: 1000 }),
      ],
      assets,
      accounts: [cocos],
      priceSeries: [],
      quotes: [],
      fxRates: [],
      asOf: "2024-01-10",
    });
    expect(p.fxMissing).toBe(false);
    expect(p.netContributedUsd).toBeCloseTo(100);
  });

  it("una cartera solo en dólares no se ve afectada", () => {
    const p = computePortfolio({
      transactions: [tx("deposit", "2024-01-01", { amount: 500 })],
      assets: [asset("qqq")],
      accounts: [cocos],
      priceSeries: [],
      quotes: [],
      fxRates: [],
      asOf: "2024-01-10",
    });
    expect(p.fxMissing).toBe(false);
    expect(p.totalValueUsd).toBeCloseTo(500);
  });
});

describe("casos límite", () => {
  it("después de vender todo queda solo efectivo y el resultado realizado", () => {
    const p = computePortfolio({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 1000 }),
        tx("buy", "2024-01-02", { amount: 1000, assetId: "qqq", quantity: 2, price: 500 }),
        tx("sell", "2024-02-01", { amount: 1200, assetId: "qqq", quantity: 2, price: 600 }),
      ],
      assets,
      accounts: [cocos],
      priceSeries: [series("qqq", "2024-01-01", 60, (i) => (i < 31 ? 500 : 600))],
      quotes: [],
      fxRates: [],
      asOf: "2024-02-20",
    });
    expect(p.positions).toEqual([]);
    expect(p.cashUsd).toBeCloseTo(1200);
    expect(p.realizedUsd).toBeCloseTo(200);
    expect(p.totalPnlUsd).toBeCloseTo(200);
    // El rendimiento tiene que seguir reflejando la suba del 20%.
    expect(p.metrics.twrCumulative).toBeGreaterThan(0.15);
  });

  it("retirar todo deja la cartera en cero sin romper las métricas", () => {
    const p = computePortfolio({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 500 }),
        tx("withdraw", "2024-03-01", { amount: 500 }),
      ],
      assets,
      accounts: [cocos],
      priceSeries: [],
      quotes: [],
      fxRates: [],
      asOf: "2024-03-10",
    });
    expect(p.totalValueUsd).toBeCloseTo(0);
    expect(p.netContributedUsd).toBeCloseTo(0);
    expect(p.totalPnlUsd).toBeCloseTo(0);
    expect(Number.isFinite(p.metrics.twrCumulative ?? 0)).toBe(true);
    expect(p.simpleReturn).toBeNull();
  });

  it("volver a entrar después de haber retirado todo no dispara el índice", () => {
    const p = computePortfolio({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 500 }),
        tx("withdraw", "2024-02-01", { amount: 500 }),
        tx("deposit", "2024-04-01", { amount: 800 }),
      ],
      assets,
      accounts: [cocos],
      priceSeries: [],
      quotes: [],
      fxRates: [],
      asOf: "2024-05-01",
    });
    expect(p.totalValueUsd).toBeCloseTo(800);
    expect(p.metrics.twrCumulative).toBeCloseTo(0, 4);
  });

  it("una cartera que perdió plata lo dice con signo negativo", () => {
    const p = computePortfolio({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 1000 }),
        tx("buy", "2024-01-02", { amount: 1000, assetId: "qqq", quantity: 2, price: 500 }),
      ],
      assets,
      accounts: [cocos],
      priceSeries: [series("qqq", "2024-01-01", 60, 500)],
      quotes: [{ assetId: "qqq", price: 300, currency: "USD", at: "", source: "yahoo" }],
      fxRates: [],
      asOf: "2024-02-20",
    });
    expect(p.totalValueUsd).toBeCloseTo(600);
    expect(p.totalPnlUsd).toBeCloseTo(-400);
    expect(p.simpleReturn).toBeCloseTo(-0.4);
    expect(p.positions[0].unrealizedPct).toBeCloseTo(-0.4);
  });

  it("un solo movimiento no rompe nada", () => {
    const p = computePortfolio({
      transactions: [tx("deposit", "2024-01-01", { amount: 100 })],
      assets,
      accounts: [cocos],
      priceSeries: [],
      quotes: [],
      fxRates: [],
      asOf: "2024-01-01",
    });
    expect(p.daily).toHaveLength(1);
    expect(p.twr).toHaveLength(1);
    expect(p.metrics.twrCumulative).toBeCloseTo(0);
    expect(p.metrics.volatility).toBeNull();
  });

  it("una cartera en pesos se valúa al MEP de cada fecha", () => {
    const ggal = asset("ggal", { currency: "ARS", source: "byma", symbol: "GGAL" });
    const p = computePortfolio({
      transactions: [
        // 1.000.000 de pesos cuando el dólar valía 1.000: US$ 1.000.
        tx("deposit", "2024-01-01", { amount: 1_000_000, currency: "ARS", fxRate: 1000 }),
        tx("buy", "2024-01-02", {
          amount: 1_000_000,
          currency: "ARS",
          fxRate: 1000,
          assetId: "ggal",
          quantity: 100,
          price: 10_000,
        }),
      ],
      assets: [ggal],
      accounts: [cocos],
      priceSeries: [series("ggal", "2024-01-01", 200, 10_000, "ARS")],
      quotes: [{ assetId: "ggal", price: 15_000, currency: "ARS", at: "", source: "byma" }],
      fxRates: [
        { date: "2024-01-01", arsPerUsd: 1000 },
        { date: "2024-06-01", arsPerUsd: 2000 },
      ],
      asOf: "2024-06-15",
    });
    expect(p.netContributedUsd).toBeCloseTo(1000);
    // La acción subió 50% en pesos pero el dólar se duplicó: en dólares perdió.
    expect(p.totalValueUsd).toBeCloseTo(750);
    expect(p.totalPnlUsd).toBeCloseTo(-250);
    expect(p.fxMissing).toBe(false);
  });

  it("un activo comprado y vendido el mismo día no deja restos", () => {
    const p = computePortfolio({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 1000 }),
        tx("buy", "2024-01-02", { amount: 500, assetId: "qqq", quantity: 1, price: 500 }),
        tx("sell", "2024-01-02", { amount: 510, assetId: "qqq", quantity: 1, price: 510 }),
      ],
      assets,
      accounts: [cocos],
      priceSeries: [series("qqq", "2024-01-01", 10, 510)],
      quotes: [],
      fxRates: [],
      asOf: "2024-01-05",
    });
    expect(p.positions).toEqual([]);
    expect(p.cashUsd).toBeCloseTo(1010);
    expect(p.realizedUsd).toBeCloseTo(10);
  });
});
