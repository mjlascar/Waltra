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
