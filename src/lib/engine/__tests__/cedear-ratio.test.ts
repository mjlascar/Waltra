import { describe, expect, it } from "vitest";
import { computePortfolio } from "@/lib/engine/portfolio";
import { ratioChanges, snapFactor, underlyingId, unitsWith, type RatioPoint } from "@/lib/engine/cedear-ratio";
import type { Asset, PriceSeries, Quote, Transaction } from "@/lib/types";

/**
 * El caso real, con numeros del mismo tipo: SPY.BA comprado dos veces con el
 * CEDEAR a 20 por accion, y dos veces despues de que paso a 50. El cambio se
 * cargo a mano como ×3 y con la fecha de la ultima compra, y la cartera quedo
 * contando unidades de mas.
 *
 * SPY vale US$ 700 todo el año para que los numeros se lean; el dolar, 1.450.
 */
const DOLAR = 1450;
const SPY_USD = 700;
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

function diaria(id: string, currency: "USD" | "ARS", precio: (d: string) => number): PriceSeries {
  const points = [];
  for (let t = Date.parse("2026-02-01T00:00:00Z"); t <= Date.parse("2026-09-25T00:00:00Z"); t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    points.push({ date, close: precio(date) });
  }
  return { assetId: id, currency, points, updatedAt: "" };
}
/** La accion en Nueva York. */
const accion = diaria(underlyingId("spy"), "USD", () => SPY_USD);
/** El CEDEAR, como lo da Yahoo: toda la historia en la escala de hoy (50 a 1). */
const cedear = diaria("spy", "ARS", () => (SPY_USD / 50) * DOLAR);

let n = 0;
const tx = (f: Partial<Transaction> & Pick<Transaction, "type" | "date" | "amount">): Transaction => ({
  id: `t${++n}`,
  accountId: "cocos",
  currency: "ARS",
  createdAt: `2026-01-01T00:00:${String(n % 60).padStart(2, "0")}.000Z`,
  updatedAt: "",
  ...f,
});
const compra = (date: string, quantity: number, ratio: number, currency: "ARS" | "USD" = "ARS") => {
  const usd = (SPY_USD / ratio) * quantity;
  return tx({
    type: "buy",
    date,
    quantity,
    assetId: "spy",
    currency,
    amount: currency === "ARS" ? usd * DOLAR : usd,
  });
};

const operaciones = [
  tx({ type: "deposit", date: "2026-02-20", amount: 2_000_000 }),
  tx({ type: "deposit", date: "2026-02-20", amount: 500, currency: "USD" }),
  compra("2026-02-25", 9, 20),
  compra("2026-04-22", 6, 20),
  compra("2026-07-27", 15, 50),
  compra("2026-09-15", 16, 50, "USD"),
];
const quotes: Quote[] = [
  { assetId: "spy", price: (SPY_USD / 50) * DOLAR, currency: "ARS", at: "2026-09-25", source: "byma" },
  { assetId: underlyingId("spy"), price: SPY_USD, currency: "USD", at: "2026-09-25", source: "yahoo" },
];
const correr = (transactions: Transaction[], series: PriceSeries[] = [accion, cedear]) =>
  computePortfolio({
    transactions,
    assets: [spy],
    accounts: [{ id: "cocos", name: "Cocos", broker: "cocos", currency: "USD", createdAt: "" }],
    priceSeries: series,
    quotes,
    fxRates: [{ date: "2026-01-01", arsPerUsd: DOLAR }],
    asOf: "2026-09-25",
  });

describe("el ratio sale de las operaciones", () => {
  it("encuentra el cambio, cuánto fue y entre qué fechas", () => {
    const [check] = correr(operaciones).ratioChecks;
    expect(check.changes).toHaveLength(1);
    expect(check.changes[0]).toMatchObject({
      lastOld: "2026-04-22",
      firstNew: "2026-07-27",
      factor: 2.5,
      exact: true,
      date: "2026-07-27",
    });
  });

  it("sin nada cargado, dice que falta y propone registrarlo", () => {
    const [check] = correr(operaciones).ratioChecks;
    expect(check.issues.map((i) => i.kind)).toEqual(["falta"]);
    expect(check.proposal).toEqual([{ date: "2026-07-27", ratio: 2.5 }]);
  });

  it("el ×3 cargado a mano no pasa", () => {
    const [check] = correr([
      ...operaciones,
      tx({ type: "split", date: "2026-07-27", amount: 0, assetId: "spy", ratio: 3 }),
    ]).ratioChecks;
    expect(check.issues).toMatchObject([{ kind: "ratio", registered: 3 }]);
  });

  it("con la fecha del 24/9, tampoco: queda fuera de la ventana y sobra", () => {
    const [check] = correr([
      ...operaciones,
      tx({ type: "split", date: "2026-09-24", amount: 0, assetId: "spy", ratio: 3 }),
    ]).ratioChecks;
    expect(check.issues.map((i) => i.kind).sort()).toEqual(["falta", "sobra"]);
  });

  it("aplicando lo propuesto, todo cierra: 15 × 2,5 + 31 = 68,5 y ninguna ganancia inventada", () => {
    const p = correr([
      ...operaciones,
      tx({ type: "split", date: "2026-07-27", amount: 0, assetId: "spy", ratio: 2.5 }),
    ]);
    expect(p.ratioChecks[0].issues).toEqual([]);
    expect(p.positions[0].quantity).toBeCloseTo(68.5, 6);
    expect(p.totalPnlUsd).toBeCloseTo(0, 4);
    // Con la evidencia de las operaciones, las heuristicas viejas no opinan.
    expect(p.priceMismatches).toEqual([]);
    expect(p.splitDateIssues).toEqual([]);
  });

  it("las unidades se pueden mostrar antes de aplicar nada", () => {
    expect(unitsWith(operaciones, "spy", [{ date: "2026-07-27", ratio: 2.5 }])).toBeCloseTo(68.5, 6);
    expect(unitsWith(operaciones, "spy", [{ date: "2026-09-24", ratio: 3 }])).toBeCloseTo(138, 6);
  });
});

describe("un cambio que todavía no tiene operaciones después", () => {
  it("lo muestra la cotización de hoy", () => {
    // Una sola compra, a 20 por acción; hoy el CEDEAR cotiza a 50.
    const [check] = correr([operaciones[0], compra("2026-03-10", 10, 20)]).ratioChecks;
    expect(check.changes).toHaveLength(1);
    expect(check.changes[0]).toMatchObject({ factor: 2.5, onlyLive: true, lastOld: "2026-03-10" });
    expect(check.issues.map((i) => i.kind)).toEqual(["falta"]);
  });

  it("con una serie cruda, la fecha es la del salto", () => {
    const cruda = diaria("spy", "ARS", (d) => (SPY_USD / (d < "2026-06-10" ? 20 : 50)) * DOLAR);
    const [check] = correr([operaciones[0], compra("2026-03-10", 10, 20)], [accion, cruda]).ratioChecks;
    expect(check.changes[0].date).toBe("2026-06-10");
  });
});

describe("ruido", () => {
  const punto = (day: string, ratio: number): RatioPoint => ({ day, ratio, from: "operacion" });

  it("la diferencia entre el MEP y el CCL no es un cambio de ratio", () => {
    expect(ratioChanges([punto("2026-01-01", 20), punto("2026-02-01", 21.5), punto("2026-03-01", 18.9)])).toEqual([]);
  });

  it("un precio mal cargado entre dos normales no es dos cambios de ratio", () => {
    expect(ratioChanges([punto("2026-01-01", 20), punto("2026-02-01", 2), punto("2026-03-01", 20)])).toEqual([]);
  });

  it("redondea a los multiplicadores que existen, y dice cuando no pudo", () => {
    expect(snapFactor(2.46)).toEqual({ factor: 2.5, exact: true });
    expect(snapFactor(0.51)).toEqual({ factor: 0.5, exact: true });
    expect(snapFactor(1.77).exact).toBe(false);
  });
});

describe("sin la serie de la acción", () => {
  it("no hay evidencia y siguen las heurísticas de siempre", () => {
    const p = correr(operaciones, [cedear]);
    expect(p.ratioChecks).toEqual([]);
  });
});
