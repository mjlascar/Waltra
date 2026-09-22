import { describe, expect, it } from "vitest";
import { buildExternalRequest, parseExternalReport } from "@/lib/insights/external";
import type { InsightRequest } from "@/lib/insights/digest";

const CARTERA: InsightRequest = {
  kind: "cartera",
  holdings: [
    {
      symbol: "QQQ",
      name: "Invesco QQQ",
      kind: "etf",
      weightPct: 100,
      valueUsd: 1000,
      costUsd: 900,
      returnPct: 11.1,
      heldDays: 200,
    },
  ],
  totals: {
    valueUsd: 1000, contributedUsd: 900, cashUsd: 0, pnlUsd: 100,
    twrPct: 11.1, xirrPct: 20, volatilityPct: 18, maxDrawdownPct: -8, ageDays: 200,
  },
  behaviour: {
    transactions: 4, depositsLast90d: 1, tradesLast90d: 1,
    avgDepositUsd: 450, accounts: ["Cocos Capital"],
  },
  profile: { riskProfile: "moderado", horizonYears: 5, goals: "" },
};

const JSON_OK = {
  marketBrief: "El mercado viene lateral.",
  signals: [
    {
      symbol: "QQQ",
      action: "mantener",
      confidence: "media",
      headline: "Sin novedades",
      rationale: "Nada cambió esta semana.",
      horizon: "1 mes",
    },
  ],
  profileRead: { summary: "Moderado.", observations: [], risks: [], suggestions: [] },
  sources: [{ title: "Reuters", url: "https://reuters.com/x" }],
};

describe("el pedido que se copia", () => {
  it("lleva la cartera, la consigna y el formato de respuesta", () => {
    const texto = buildExternalRequest(CARTERA, "cartera");
    expect(texto).toContain("QQQ");
    expect(texto).toContain("Una lectura por posicion");
    expect(texto).toContain('"marketBrief"');
    // Tiene que poder pegarse en cualquier chat y funcionar solo.
    expect(texto).toContain("## Cartera");
    expect(texto).toContain("## Formato de respuesta");
  });

  it("cambia la consigna según el tipo de informe", () => {
    expect(buildExternalRequest(CARTERA, "mercado")).toContain("Oportunidades afuera de la cartera");
    expect(buildExternalRequest(CARTERA, "cartera")).not.toContain("Oportunidades afuera");
  });

  it("no filtra montos de movimientos ni nombres de cuenta de más", () => {
    // Lo mismo que ya fija el test del digest: al modelo solo van tickers,
    // pesos y números.
    const texto = buildExternalRequest(CARTERA, "cartera");
    expect(texto).not.toContain("accountId");
  });
});

describe("lo que se pega de vuelta", () => {
  it("lee el JSON cercado en un bloque de código", () => {
    const pegado = `Acá va el análisis.\n\n\`\`\`json\n${JSON.stringify(JSON_OK)}\n\`\`\`\n`;
    const report = parseExternalReport(pegado);
    expect(report?.degraded).toBe(false);
    expect(report?.signals[0].symbol).toBe("QQQ");
    expect(report?.sources[0].url).toBe("https://reuters.com/x");
  });

  it("lee el JSON aunque venga sin cercado", () => {
    const report = parseExternalReport(JSON.stringify(JSON_OK));
    expect(report?.degraded).toBe(false);
  });

  it("acepta prosa suelta y la guarda como informe degradado", () => {
    // Es lo que devuelve cualquier chat si no le insistís con el formato.
    const report = parseExternalReport(
      "El Nasdaq subió 2% esta semana. Fuente: https://reuters.com/nota",
    );
    expect(report?.degraded).toBe(true);
    expect(report?.marketBrief).toContain("Nasdaq");
    // Las URLs de la prosa se rescatan como fuentes.
    expect(report?.sources.map((s) => s.url)).toContain("https://reuters.com/nota");
  });

  it("un JSON que no cumple el esquema no se tira: queda como prosa", () => {
    const report = parseExternalReport('{"cualquier": "cosa"} y un poco de texto alrededor');
    expect(report?.degraded).toBe(true);
  });

  it("rescata las fuentes de la prosa cuando el JSON vino sin ellas", () => {
    const sinFuentes = { ...JSON_OK, sources: [] };
    const pegado = `Ver https://bloomberg.com/y\n\n\`\`\`json\n${JSON.stringify(sinFuentes)}\n\`\`\``;
    const report = parseExternalReport(pegado);
    expect(report?.degraded).toBe(false);
    expect(report?.sources.map((s) => s.url)).toContain("https://bloomberg.com/y");
  });

  it("un pegado vacío o de dos palabras no crea un informe", () => {
    expect(parseExternalReport("")).toBeNull();
    expect(parseExternalReport("  nada  ")).toBeNull();
  });
});
