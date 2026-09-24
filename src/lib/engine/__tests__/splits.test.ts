import { describe, expect, it } from "vitest";
import { computePortfolio } from "@/lib/engine/portfolio";
import { collectSplits, priceFactor, seriesAdjustedFor, unitsFactor } from "@/lib/engine/splits";
import { parseSplits, type ChartResponse } from "@/lib/market/yahoo";
import type { Asset, PriceSeries, Transaction } from "@/lib/types";

/**
 * El caso real: 9 CEDEARs de SPY comprados el 25 de febrero a $ 50.705. En
 * junio el CEDEAR cambió de ratio (cada uno pasó a ser 2,5) y Yahoo dio toda
 * la historia ajustada: para Yahoo, el 25 de febrero valía $ 20.282.
 *
 * Sin entender el split, la app valuaba 9 unidades a $ 20.282 el mismo día de
 * la compra —una pérdida instantánea de US$ 190— y decía que el CEDEAR
 * "bajó 59,6%" desde la compra.
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

const DOLAR = 1450;
const SPLIT = { date: "2026-06-10", ratio: 2.5 };

let n = 0;
function tx(fields: Partial<Transaction> & Pick<Transaction, "type" | "date" | "amount">): Transaction {
  n += 1;
  return {
    id: `t${n}`,
    accountId: "cocos",
    currency: "ARS",
    createdAt: `2026-01-01T00:00:${String(n % 60).padStart(2, "0")}.000Z`,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...fields,
  };
}

/** Una serie diaria plana, del 20 de febrero al 1 de septiembre. */
function serie(precio: (day: string) => number, splits?: PriceSeries["splits"]): PriceSeries {
  const points = [];
  const start = Date.parse("2026-02-20T00:00:00Z");
  for (let i = 0; i < 194; i++) {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    points.push({ date, close: precio(date) });
  }
  return { assetId: "spy", currency: "ARS", points, splits, updatedAt: "" };
}

/** Como la entrega Yahoo: todo en la escala de hoy, 50.705 / 2,5. */
const ajustada = (splits?: PriceSeries["splits"]) => serie(() => 50_705 / 2.5, splits);
/** Como seria una serie cruda: el salto esta en los datos. */
const cruda = serie((d) => (d < SPLIT.date ? 50_705 : 50_705 / 2.5));

const compra = [
  tx({ type: "deposit", date: "2026-02-20", amount: 460_000 }),
  tx({ type: "buy", date: "2026-02-25", amount: 456_345, assetId: "spy", quantity: 9, price: 50_705 }),
];

function correr(transactions: Transaction[], series: PriceSeries) {
  return computePortfolio({
    transactions,
    assets: [spy],
    accounts: [{ id: "cocos", name: "Cocos Capital", broker: "cocos", currency: "USD", createdAt: "" }],
    priceSeries: [series],
    quotes: [{ assetId: "spy", price: 50_705 / 2.5, currency: "ARS", at: "2026-09-01", source: "byma" }],
    fxRates: [{ date: "2026-02-01", arsPerUsd: DOLAR }],
    asOf: "2026-09-01",
  });
}

const navDe = (p: ReturnType<typeof correr>, day: string) => p.daily.find((d) => d.day === day)!.nav;

describe("el caso real, con el split informado por el proveedor", () => {
  const p = correr(compra, ajustada([SPLIT]));

  it("la posición tiene las unidades de hoy", () => {
    expect(p.positions[0].quantity).toBeCloseTo(22.5, 6);
    expect(p.positions[0].avgCost).toBeCloseTo(50_705 / 2.5, 2);
  });

  it("no hay pérdida el día de la compra", () => {
    // El 25 de febrero la cartera vale lo que entró.
    expect(navDe(p, "2026-02-25")).toBeCloseTo(460_000 / DOLAR, 2);
  });

  it("el día del split el valor no salta", () => {
    expect(navDe(p, "2026-06-10")).toBeCloseTo(navDe(p, "2026-06-09"), 2);
  });

  it("la ganancia es la real, no un derrumbe", () => {
    expect(p.totalPnlUsd).toBeCloseTo(0, 2);
    expect(p.metrics.maxDrawdown.value).toBeCloseTo(0, 4);
  });

  it("no hay compras sospechosas", () => {
    expect(p.priceMismatches).toEqual([]);
  });

  it("la compra vieja se muestra en unidades de hoy", () => {
    const [t] = p.positions[0].trades;
    expect(t.quantity).toBeCloseTo(22.5, 6);
    expect(t.unitsFactor).toBeCloseTo(2.5);
    expect(t.priceUsd! * DOLAR).toBeCloseTo(50_705 / 2.5, 2);
  });
});

describe("el caso real, sin que nadie informe el split", () => {
  const p = correr(compra, ajustada());

  it("la compra no cierra con la cotización de ese día, y se detecta", () => {
    expect(p.priceMismatches).toHaveLength(1);
    expect(p.priceMismatches[0]).toMatchObject({ symbol: "SPY.BA", day: "2026-02-25" });
    expect(p.priceMismatches[0].factor).toBeCloseTo(2.5, 2);
  });

  it("y cargarlo a mano lo arregla todo", () => {
    const conSplit = correr(
      [...compra, tx({ type: "split", date: SPLIT.date, amount: 0, assetId: "spy", ratio: 2.5 })],
      ajustada(),
    );
    expect(conSplit.positions[0].quantity).toBeCloseTo(22.5, 6);
    expect(navDe(conSplit, "2026-02-25")).toBeCloseTo(460_000 / DOLAR, 2);
    expect(conSplit.totalPnlUsd).toBeCloseTo(0, 2);
    expect(conSplit.priceMismatches).toEqual([]);
  });
});

describe("una serie cruda no se ajusta dos veces", () => {
  it("con el salto en los datos, el split solo cambia las unidades", () => {
    const p = correr(
      [...compra, tx({ type: "split", date: SPLIT.date, amount: 0, assetId: "spy", ratio: 2.5 })],
      cruda,
    );
    expect(p.splits.spy[0].adjusted).toBe(false);
    expect(navDe(p, "2026-02-25")).toBeCloseTo(460_000 / DOLAR, 2);
    expect(navDe(p, "2026-06-10")).toBeCloseTo(navDe(p, "2026-06-09"), 2);
    expect(p.totalPnlUsd).toBeCloseTo(0, 2);
  });
});

describe("un split no mueve plata", () => {
  it("el valor, el capital y la ganancia son los mismos antes y después", () => {
    const antes = correr(compra, ajustada([{ date: "2026-09-01", ratio: 2.5 }]));
    const sin = correr(compra, serie(() => 50_705));
    // Con o sin el split del último día, la cartera vale lo mismo.
    expect(antes.netContributedUsd).toBeCloseTo(sin.netContributedUsd, 6);
    expect(antes.totalValueUsd).toBeCloseTo(antes.cashUsd + antes.investedUsd, 6);
    expect(antes.realizedUsd).toBe(0);
  });
});

describe("splits que no corresponden", () => {
  it("uno anterior a la primera compra no cambia nada", () => {
    const p = correr(compra, ajustada([{ date: "2026-01-10", ratio: 3 }]));
    expect(p.positions[0].quantity).toBeCloseTo(9, 6);
    expect(p.firstDay).toBe("2026-02-20");
  });

  it("los de un activo sin operaciones no inventan una cartera", () => {
    const p = computePortfolio({
      transactions: [],
      assets: [spy],
      accounts: [],
      priceSeries: [ajustada([SPLIT])],
      quotes: [],
      fxRates: [],
      asOf: "2026-09-01",
    });
    expect(p.hasData).toBe(false);
  });

  it("si el proveedor y el usuario cargan el mismo, cuenta una vez", () => {
    const p = correr(
      [...compra, tx({ type: "split", date: "2026-06-12", amount: 0, assetId: "spy", ratio: 2.5 })],
      ajustada([SPLIT]),
    );
    expect(p.splits.spy).toHaveLength(1);
    expect(p.positions[0].quantity).toBeCloseTo(22.5, 6);
  });
});

describe("factores", () => {
  const splits = [
    { date: "2026-03-01", ratio: 2, source: "proveedor" as const, adjusted: true },
    { date: "2026-06-01", ratio: 2.5, source: "manual" as const, adjusted: false },
  ];

  it("las unidades cuentan todos los splits posteriores", () => {
    expect(unitsFactor(splits, "2026-02-01")).toBeCloseTo(5);
    expect(unitsFactor(splits, "2026-04-01")).toBeCloseTo(2.5);
    expect(unitsFactor(splits, "2026-07-01")).toBe(1);
  });

  it("el precio solo deshace los ajustes que la serie tiene", () => {
    expect(priceFactor(splits, "2026-02-01")).toBeCloseTo(2);
    expect(priceFactor(splits, "2026-04-01")).toBe(1);
  });

  it("reconoce una serie ajustada y una cruda", () => {
    expect(seriesAdjustedFor(ajustada().points, SPLIT)).toBe(true);
    expect(seriesAdjustedFor(cruda.points, SPLIT)).toBe(false);
    // Sin datos alrededor se asume lo que hace Yahoo.
    expect(seriesAdjustedFor([], SPLIT)).toBe(true);
  });

  it("junta manuales y del proveedor sin repetir", () => {
    const r = collectSplits(
      [tx({ type: "split", date: "2026-06-11", amount: 0, assetId: "spy", ratio: 2.5 })],
      [ajustada([SPLIT, { date: "2026-08-01", ratio: 2 }])],
    );
    expect(r.spy.map((s) => [s.source, s.ratio])).toEqual([
      ["manual", 2.5],
      ["proveedor", 2],
    ]);
  });
});

describe("parseSplits", () => {
  const respuesta = (splits: Record<string, unknown>): ChartResponse =>
    ({
      chart: { result: [{ meta: {}, indicators: { quote: [{}] }, events: { splits } }] },
    }) as unknown as ChartResponse;

  it("lee el ratio como numerador sobre denominador", () => {
    const r = parseSplits(
      respuesta({ "1781092800": { date: 1781092800, numerator: 5, denominator: 2, splitRatio: "5:2" } }),
    );
    expect(r).toEqual([{ date: "2026-06-10", ratio: 2.5 }]);
  });

  it("descarta lo incompleto o absurdo", () => {
    expect(
      parseSplits(
        respuesta({
          a: { date: 1781092800, numerator: 0, denominator: 2 },
          b: { date: 1781092800 },
          c: { date: 1781092800, numerator: 1, denominator: 1 },
        }),
      ),
    ).toEqual([]);
  });

  it("sin eventos devuelve lista vacía", () => {
    expect(parseSplits({ chart: { result: [] } } as unknown as ChartResponse)).toEqual([]);
  });
});
