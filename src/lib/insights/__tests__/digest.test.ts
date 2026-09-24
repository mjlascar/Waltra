import { describe, expect, it } from "vitest";
import {
  InsightRequestSchema,
  ReportSchema,
  buildDigest,
  degradedReport,
  extractUrls,
  type InsightRequest,
} from "@/lib/insights/digest";

const base: InsightRequest = {
  kind: "cartera",
  holdings: [
    {
      symbol: "QQQ",
      name: "Invesco QQQ",
      kind: "etf",
      weightPct: 38.2,
      valueUsd: 1460,
      costUsd: 1341,
      returnPct: 8.9,
      heldDays: 400,
      account: "Cocos Capital",
    },
    {
      symbol: "BTC",
      kind: "crypto",
      weightPct: 27.6,
      valueUsd: 1056,
      costUsd: 760,
      returnPct: 38.9,
      heldDays: 330,
    },
  ],
  totals: {
    valueUsd: 4080,
    contributedUsd: 3550,
    cashUsd: 256,
    pnlUsd: 530,
    twrPct: 19.6,
    xirrPct: 20,
    volatilityPct: 24.1,
    maxDrawdownPct: -12.4,
    ageDays: 400,
  },
  behaviour: {
    transactions: 18,
    depositsLast90d: 2,
    tradesLast90d: 3,
    avgDepositUsd: 591,
    accounts: ["Cocos Capital", "Binance"],
  },
  profile: { riskProfile: "moderado", horizonYears: 5, goals: "Comprar un departamento." },
};

describe("buildDigest", () => {
  it("incluye los totales y cada posición", () => {
    const text = buildDigest(base);
    expect(text).toContain("Valor total: US$ 4080");
    expect(text).toContain("Capital aportado: US$ 3550");
    expect(text).toContain("TWR: 19.6%");
    expect(text).toContain("- QQQ (etf, Cocos Capital): 38.2%");
    expect(text).toContain("- BTC (crypto): 27.6%");
    expect(text).toContain("Perfil declarado: moderado, horizonte 5 anios");
    expect(text).toContain("Comprar un departamento.");
  });

  it("dice s/d en vez de inventar cuando falta una métrica", () => {
    const text = buildDigest({
      ...base,
      totals: { ...base.totals, twrPct: null, xirrPct: null, volatilityPct: null },
      behaviour: { ...base.behaviour, avgDepositUsd: null },
    });
    expect(text).toContain("TWR: s/d");
    expect(text).toContain("TIR anual: s/d");
    expect(text).toContain("Ingreso promedio: s/d");
  });

  it("no manda ningún dato personal", () => {
    const text = buildDigest(base);
    // Solo viajan tickers, numeros y los nombres de cuenta que el usuario eligio.
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/\b\d{2}\/\d{2}\/\d{4}\b/);
  });

  it("aguanta una cartera vacía", () => {
    const text = buildDigest({ ...base, holdings: [] });
    expect(text).toContain("- (ninguna)");
  });
});

describe("InsightRequestSchema", () => {
  it("acepta un pedido completo", () => {
    expect(InsightRequestSchema.safeParse(base).success).toBe(true);
  });

  it("rechaza lo que no tiene forma de pedido", () => {
    expect(InsightRequestSchema.safeParse({}).success).toBe(false);
    expect(InsightRequestSchema.safeParse(null).success).toBe(false);
  });

  it("corta objetivos y preguntas demasiado largos", () => {
    const largo = { ...base, profile: { ...base.profile, goals: "x".repeat(700) } };
    expect(InsightRequestSchema.safeParse(largo).success).toBe(false);
  });

  it("limita la cantidad de posiciones", () => {
    const muchas = { ...base, holdings: Array(61).fill(base.holdings[0]) };
    expect(InsightRequestSchema.safeParse(muchas).success).toBe(false);
  });
});

describe("extractUrls", () => {
  it("rescata las fuentes citadas en el texto", () => {
    const urls = extractUrls(
      "Según https://www.reuters.com/markets/nota-1 y también (https://ambito.com/x.html), las tasas…",
    );
    expect(urls).toEqual([
      { title: "reuters.com", url: "https://www.reuters.com/markets/nota-1" },
      { title: "ambito.com", url: "https://ambito.com/x.html" },
    ]);
  });

  it("no repite la misma URL", () => {
    expect(extractUrls("https://a.com/x https://a.com/x")).toHaveLength(1);
  });

  it("limpia la puntuación final", () => {
    expect(extractUrls("mirá https://a.com/nota.")[0].url).toBe("https://a.com/nota");
  });

  it("sin URLs devuelve lista vacía", () => {
    expect(extractUrls("sin fuentes")).toEqual([]);
  });
});

describe("degradedReport", () => {
  it("conserva el informe y sus fuentes cuando falla el estructurado", () => {
    const brief = "El Nasdaq subió. Fuente: https://reuters.com/nota";
    const report = degradedReport(brief);
    expect(report.marketBrief).toContain("El Nasdaq subió");
    expect(report.sources[0].url).toBe("https://reuters.com/nota");
    expect(report.signals).toEqual([]);
    // Tiene que seguir siendo un informe valido para la app.
    expect(ReportSchema.safeParse(report).success).toBe(true);
  });
});

describe("la historia de cada posición", () => {
  const conHistoria: InsightRequest = {
    ...base,
    holdings: [
      {
        ...base.holdings[0],
        symbol: "QQQ.BA",
        kind: "cedear",
        quantity: 59,
        avgCostUsd: 22.73,
        priceUsd: 24.75,
        realizedUsd: 0,
        trades: [
          { date: "2025-08-20", side: "compra", quantity: 30, priceUsd: 21.5 },
          { date: "2026-03-28", side: "compra", quantity: 16, priceUsd: 23.5 },
          { date: "2026-09-03", side: "compra", quantity: 13, priceUsd: 24.6 },
        ],
      },
    ],
    closed: [
      {
        symbol: "MELI.BA",
        kind: "cedear",
        realizedUsd: 40,
        trades: [
          { date: "2025-10-01", side: "compra", quantity: 5, priceUsd: 92.5 },
          { date: "2026-05-01", side: "venta", quantity: 5, priceUsd: 100.5 },
        ],
      },
    ],
  };

  it("cada compra viaja con su fecha y su precio", () => {
    const text = buildDigest(conHistoria);
    expect(text).toContain("59 unidades, costo promedio US$ 22.73 por unidad, precio actual US$ 24.75");
    expect(text).toContain(
      "Operaciones: 2025-08-20 compra 30 a US$ 21.50; 2026-03-28 compra 16 a US$ 23.50; 2026-09-03 compra 13 a US$ 24.60",
    );
  });

  it("lo que se vendió entero también viaja", () => {
    const text = buildDigest(conHistoria);
    expect(text).toContain("Posiciones cerradas");
    expect(text).toContain("MELI.BA (cedear): resultado realizado US$ 40");
    expect(text).toContain("2026-05-01 venta 5 a US$ 100.50");
  });

  it("dice cuántas operaciones viejas quedaron afuera", () => {
    const text = buildDigest({
      ...conHistoria,
      holdings: [{ ...conHistoria.holdings[0], olderTrades: 12 }],
    });
    expect(text).toContain("(y 12 anteriores)");
  });

  it("una compra en pesos sin dólar no se hace pasar por dólares", () => {
    const text = buildDigest({
      ...conHistoria,
      holdings: [
        {
          ...conHistoria.holdings[0],
          trades: [{ date: "2026-02-25", side: "compra", quantity: 9, priceUsd: null }],
        },
      ],
    });
    expect(text).toContain("compra 9 (precio en pesos, sin dolar)");
  });

  it("las notas y la frase original no viajan aunque alguien las mande", () => {
    // El esquema descarta lo que no conoce: una nota puede decir cualquier
    // cosa, y al modelo solo van tickers y números.
    const parsed = InsightRequestSchema.parse({
      ...conHistoria,
      holdings: [
        {
          ...conHistoria.holdings[0],
          trades: [
            { date: "2026-02-25", side: "compra", quantity: 9, priceUsd: 33, note: "para el viaje con Ana", raw: "compré..." },
          ],
        },
      ],
    });
    expect(JSON.stringify(parsed)).not.toContain("Ana");
    expect(JSON.stringify(parsed)).not.toContain('"raw"');
    expect(JSON.stringify(parsed)).not.toContain('"note"');
  });

  it("limita la cantidad de operaciones por activo", () => {
    const muchas = Array.from({ length: 31 }, (_, i) => ({
      date: "2026-01-01",
      side: "compra" as const,
      quantity: 1,
      priceUsd: 10 + i,
    }));
    const pedido = { ...conHistoria, holdings: [{ ...conHistoria.holdings[0], trades: muchas }] };
    expect(InsightRequestSchema.safeParse(pedido).success).toBe(false);
  });

  it("un pedido sin historia sigue siendo válido", () => {
    // Informes guardados y el camino externo de versiones anteriores.
    expect(InsightRequestSchema.safeParse(base).success).toBe(true);
  });
});
