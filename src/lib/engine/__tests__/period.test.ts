import { describe, expect, it } from "vitest";
import { computePortfolio } from "@/lib/engine/portfolio";
import { periodView } from "@/lib/engine/period";
import { asset, cocos, series, tx } from "./helpers";

const assets = [asset("qqq")];

/**
 * Una cartera de 20 días: entra capital el día 1, se compra el día 2, el
 * precio sube en escalones y el día 11 entra más capital.
 *
 * Esta forma es la que importa: si la ganancia del período no descontara el
 * aporte del día 11, la ventana de los últimos diez días mostraría ese aporte
 * como si lo hubiera ganado la cartera, que es exactamente el problema que la
 * app existe para no tener.
 */
function cartera() {
  return computePortfolio({
    transactions: [
      tx("deposit", "2024-01-01", { amount: 1000 }),
      tx("buy", "2024-01-02", { amount: 1000, assetId: "qqq", quantity: 10, price: 100 }),
      tx("deposit", "2024-01-11", { amount: 500 }),
    ],
    assets,
    accounts: [cocos],
    // 100 hasta el día 10 y 120 desde el 11: la cartera gana 200 en el tramo.
    priceSeries: [series("qqq", "2024-01-01", 20, (i) => (i < 10 ? 100 : 120))],
    quotes: [{ assetId: "qqq", price: 120, currency: "USD", at: "2024-01-20", source: "yahoo" }],
    fxRates: [],
    asOf: "2024-01-20",
  });
}

describe("periodView", () => {
  it("la ventana completa da los mismos números de siempre", () => {
    const p = cartera();
    const v = periodView(p.daily, p.twr, p.firstDay!)!;
    expect(v.full).toBe(true);
    expect(v.pnlUsd).toBeCloseTo(p.totalPnlUsd, 6);
    expect(v.contributedUsd).toBeCloseTo(p.netContributedUsd, 6);
    expect(v.twr).toBeCloseTo(p.metrics.twrCumulative!, 6);
    expect(v.endValueUsd).toBeCloseTo(p.daily[p.daily.length - 1].nav, 6);
  });

  it("no cuenta el capital que entró como ganancia del período", () => {
    const p = cartera();
    // Del 10 al 20: la cartera vale 1200 + 500 de efectivo = 1700, y arrancó
    // la ventana valiendo 1000. De esos 700, 500 son plata que puso él.
    const v = periodView(p.daily, p.twr, "2024-01-10")!;
    expect(v.startValueUsd).toBeCloseTo(1000, 6);
    expect(v.endValueUsd).toBeCloseTo(1700, 6);
    expect(v.netFlowUsd).toBeCloseTo(500, 6);
    expect(v.pnlUsd).toBeCloseTo(200, 6);
    expect(v.contributedUsd).toBeCloseTo(500, 6);
    expect(v.full).toBe(false);
  });

  it("el aporte del primer día de la ventana no se resta dos veces", () => {
    const p = cartera();
    // El 11 entran 500 y el precio sube el mismo dia: al cierre del 11 la
    // cartera ya vale 1700, asi que la ventana que arranca ese dia no ganó
    // nada mas hasta el 20.
    const v = periodView(p.daily, p.twr, "2024-01-11")!;
    expect(v.startValueUsd).toBeCloseTo(1700, 6);
    expect(v.netFlowUsd).toBeCloseTo(0, 6);
    expect(v.pnlUsd).toBeCloseTo(0, 6);
    // Pero el aporte igual entró en la ventana y se muestra.
    expect(v.contributedUsd).toBeCloseTo(500, 6);
  });

  it("el rendimiento se reindexa al primer día de la ventana", () => {
    const p = cartera();
    const v = periodView(p.daily, p.twr, "2024-01-10")!;
    // El TWR neutraliza el aporte: 1000 -> 1200 son 20%, no 70%.
    expect(v.twr).toBeCloseTo(0.2, 4);
  });

  it("no anualiza una ventana corta", () => {
    const p = cartera();
    // Estirar diez días a un año da números de tres cifras que no dicen nada.
    expect(periodView(p.daily, p.twr, "2024-01-10")!.xirr).toBeNull();
    expect(periodView(p.daily, p.twr, p.firstDay!)!.xirr).toBeNull();
  });

  it("anualiza cuando el período da para eso", () => {
    const p = computePortfolio({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 1000 }),
        tx("buy", "2024-01-01", { amount: 1000, assetId: "qqq", quantity: 10, price: 100 }),
      ],
      assets,
      accounts: [cocos],
      priceSeries: [series("qqq", "2024-01-01", 400, (i) => 100 * (1 + i * 0.001))],
      quotes: [],
      fxRates: [],
      asOf: "2024-06-30",
    });
    const v = periodView(p.daily, p.twr, "2024-01-01")!;
    expect(v.days).toBeGreaterThanOrEqual(90);
    expect(v.xirr).not.toBeNull();
    expect(v.xirr!).toBeGreaterThan(0);
  });

  it("una ventana sin días devuelve null", () => {
    const p = cartera();
    expect(periodView(p.daily, p.twr, "2030-01-01")).toBeNull();
  });
});
