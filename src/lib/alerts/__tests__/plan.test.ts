import { describe, expect, it } from "vitest";
import { buildAlertPlan, DEFAULT_ALERTS, thresholdFor, type AlertRules } from "@/lib/alerts/plan";
import { computePortfolio } from "@/lib/engine/portfolio";
import { DEFAULT_SETTINGS } from "@/lib/db";
import { asset, binance, cocos, tx } from "@/lib/engine/__tests__/helpers";
import type { Settings } from "@/lib/types";

/**
 * El plan es todo lo que el vigia sabe de la cartera. Lo que se prueba aca es
 * tanto lo que lleva como lo que deliberadamente no lleva.
 */

const btc = asset("btc", { symbol: "BTC", kind: "crypto", source: "binance", sourceSymbol: "BTCUSDT" });
const qqq = asset("qqq", { symbol: "QQQ", source: "yahoo", sourceSymbol: "QQQ" });

function cartera() {
  return computePortfolio({
    transactions: [
      tx("deposit", "2026-01-10", { amount: 10000, accountId: "cocos" }),
      tx("buy", "2026-01-11", { amount: 5000, assetId: "qqq", quantity: 10, price: 500 }),
      tx("deposit", "2026-01-10", { amount: 5000, accountId: "binance" }),
      tx("buy", "2026-01-12", {
        amount: 2000,
        assetId: "btc",
        quantity: 0.02,
        price: 100000,
        accountId: "binance",
      }),
    ],
    assets: [btc, qqq],
    accounts: [cocos, binance],
    priceSeries: [],
    quotes: [],
    fxRates: [],
  });
}

function ajustes(alerts: Partial<AlertRules>): Settings {
  return { ...DEFAULT_SETTINGS, alerts: { ...DEFAULT_ALERTS, ...alerts } };
}

describe("umbral por activo", () => {
  it("cae en el general cuando no hay excepcion", () => {
    const rules = { ...DEFAULT_ALERTS, defaultPct: 5, perAsset: { btc: 12 } };
    expect(thresholdFor(rules, "qqq")).toBe(5);
    expect(thresholdFor(rules, "btc")).toBe(12);
  });

  it("un cero es una excepcion valida, no un campo vacio", () => {
    const rules = { ...DEFAULT_ALERTS, defaultPct: 5, perAsset: { btc: 0 } };
    expect(thresholdFor(rules, "btc")).toBe(0);
  });
});

describe("armado del plan", () => {
  it("no arma nada si las alertas estan apagadas", () => {
    expect(buildAlertPlan(cartera(), [btc, qqq], ajustes({ enabled: false }), 1000)).toBeNull();
  });

  it("lleva los activos con su origen y su umbral", () => {
    const plan = buildAlertPlan(
      cartera(),
      [btc, qqq],
      ajustes({ enabled: true, defaultPct: 5, perAsset: { btc: 10 } }),
      1450,
    );
    expect(plan).not.toBeNull();
    const porSimbolo = Object.fromEntries(plan!.assets.map((a) => [a.sym, a]));
    expect(porSimbolo.BTC).toMatchObject({ src: "binance", ss: "BTCUSDT", qty: 0.02, pct: 10 });
    expect(porSimbolo.QQQ).toMatchObject({ src: "yahoo", ss: "QQQ", qty: 10, pct: 5 });
    expect(plan!.arsPerUsd).toBe(1450);
  });

  it("no lleva movimientos, ni costo, ni ganancia", () => {
    const plan = buildAlertPlan(cartera(), [btc, qqq], ajustes({ enabled: true }), 1000);
    const texto = JSON.stringify(plan);
    expect(texto).not.toContain("avgCost");
    expect(texto).not.toContain("unrealized");
    expect(texto).not.toContain("netContributed");
    // Lo unico que viaja de cada activo son estos seis campos.
    expect(Object.keys(plan!.assets[0]).sort()).toEqual(
      ["cur", "pct", "qty", "src", "ss", "sym"].sort(),
    );
  });

  it("deja afuera los activos de precio manual", () => {
    const aMano = asset("efe", { symbol: "EFE", source: "manual", sourceSymbol: "EFE" });
    const p = computePortfolio({
      transactions: [
        tx("deposit", "2026-01-10", { amount: 1000 }),
        tx("buy", "2026-01-11", { amount: 500, assetId: "efe", quantity: 5, price: 100 }),
      ],
      assets: [aMano],
      accounts: [cocos],
      priceSeries: [],
      quotes: [],
      fxRates: [],
    });
    expect(buildAlertPlan(p, [aMano], ajustes({ enabled: true }), 1000)).toBeNull();
  });

  it("sin nada que vigilar no deja plan, para no despertar al telefono al pedo", () => {
    const plan = buildAlertPlan(
      cartera(),
      [btc, qqq],
      ajustes({ enabled: true, defaultPct: 0, portfolioPct: 0, digestHour: null }),
      1000,
    );
    expect(plan).toBeNull();
  });

  it("alcanza con el resumen diario para que haya plan", () => {
    const plan = buildAlertPlan(
      cartera(),
      [btc, qqq],
      ajustes({ enabled: true, defaultPct: 0, portfolioPct: 0, digestHour: 18 }),
      1000,
    );
    expect(plan?.digestHour).toBe(18);
  });

  it("una franja de silencio de ancho cero es no tener franja", () => {
    const plan = buildAlertPlan(
      cartera(),
      [btc, qqq],
      ajustes({ enabled: true, quietFrom: 8, quietTo: 8 }),
      1000,
    );
    expect(plan?.quiet).toBeNull();
  });

  it("sin cotizacion del dolar el cambio va en cero, no en uno", () => {
    // Un uno haria que el vigia cuente cada peso como un dolar.
    const plan = buildAlertPlan(cartera(), [btc, qqq], ajustes({ enabled: true }), 0);
    expect(plan?.arsPerUsd).toBe(0);
  });
});
