import { describe, expect, it } from "vitest";
import { bondBase, bondCandidate, duplicateBonds, looksLikeBymaTicker, sameBond } from "@/lib/bonds";
import { assetFromSymbol } from "@/lib/assets";
import { computePortfolio } from "@/lib/engine/portfolio";

describe("bonos y ON", () => {
  it("VSCYO se puede cargar: pesos, cada 100 nominales", () => {
    expect(bondCandidate("vscyo")).toMatchObject({
      symbol: "VSCYO",
      kind: "bond",
      currency: "ARS",
      source: "byma",
      priceUnit: 100,
    });
  });

  it("la especie en dólares se opera en dólares", () => {
    expect(bondCandidate("VSCYD")?.currency).toBe("USD");
    expect(bondCandidate("GD30C")?.currency).toBe("USD");
  });

  it("un nombre no es un ticker", () => {
    expect(looksLikeBymaTicker("Vista Energy")).toBe(false);
    expect(bondCandidate("ab")).toBeNull();
  });

  it("el activo se crea con su unidad de cotización", () => {
    const c = bondCandidate("VSCYO")!;
    expect(assetFromSymbol("VSCYO", "x", { catalog: { ...c, aliases: [] } }).priceUnit).toBe(100);
  });

  it("valuado con el precio por nominal, 1.000 nominales a $ 108.000 cada 100 son $ 1.080.000", () => {
    const asset = { ...assetFromSymbol("VSCYO", "vsc", { catalog: { ...bondCandidate("VSCYO")!, aliases: [] } }) };
    const p = computePortfolio({
      transactions: [
        { id: "d", date: "2026-09-01", type: "deposit", accountId: "cocos", amount: 1_080_000, currency: "ARS", createdAt: "1", updatedAt: "" },
        { id: "b", date: "2026-09-02", type: "buy", accountId: "cocos", assetId: "vsc", quantity: 1000, price: 1080, amount: 1_080_000, currency: "ARS", createdAt: "2", updatedAt: "" },
      ],
      assets: [asset],
      accounts: [{ id: "cocos", name: "Cocos", broker: "cocos", currency: "USD", createdAt: "" }],
      priceSeries: [],
      // La cotizacion ya guardada por nominal, como la deja la sincronizacion.
      quotes: [{ assetId: "vsc", price: 1080, currency: "ARS", at: "2026-09-29", source: "byma" }],
      fxRates: [{ date: "2026-01-01", arsPerUsd: 1500 }],
      asOf: "2026-09-29",
    });
    expect(p.totalValueUsd).toBeCloseTo(1_080_000 / 1500, 6);
    expect(p.totalPnlUsd).toBeCloseTo(0, 6);
  });
});

describe("la misma especie con otra letra de moneda", () => {
  const bono = (symbol: string, currency: "ARS" | "USD") =>
    ({ id: symbol, symbol, kind: "bond", currency }) as const;

  it("VSCYO y VSCYD son la misma ON; AL30 y AL30D, el mismo bono", () => {
    expect(bondBase("VSCYO")).toBe(bondBase("VSCYD"));
    expect(bondBase("AL30D")).toBe("AL30");
    expect(bondBase("AL30")).toBe("AL30");
  });

  it("encuentra la ya cargada", () => {
    expect(sameBond([bono("VSCYO", "ARS")], "VSCYD")?.symbol).toBe("VSCYO");
    expect(sameBond([bono("VSCYO", "ARS")], "YMCXO")).toBeUndefined();
  });

  it("agrupa las repetidas, con la de pesos primero", () => {
    const grupos = duplicateBonds([bono("VSCYD", "USD"), bono("VSCYO", "ARS"), bono("GD30", "USD")]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].map((a) => a.symbol)).toEqual(["VSCYO", "VSCYD"]);
  });

  it("unificadas, una compra en dólares y otra en pesos dan una sola tenencia que vale lo que costó", () => {
    const asset = { ...assetFromSymbol("VSCYO", "vsc", { catalog: { ...bondCandidate("VSCYO")!, aliases: [] } }) };
    const p = computePortfolio({
      transactions: [
        { id: "d1", date: "2026-09-01", type: "deposit", accountId: "cocos", amount: 1_080_000, currency: "ARS", createdAt: "1", updatedAt: "" },
        { id: "d2", date: "2026-09-01", type: "deposit", accountId: "cocos", amount: 720, currency: "USD", createdAt: "2", updatedAt: "" },
        { id: "b1", date: "2026-09-02", type: "buy", accountId: "cocos", assetId: "vsc", quantity: 1000, price: 1080, amount: 1_080_000, currency: "ARS", createdAt: "3", updatedAt: "" },
        // La D, comprada con dólares: US$ 0,72 por nominal a 1.500 son $ 1.080.
        { id: "b2", date: "2026-09-02", type: "buy", accountId: "cocos", assetId: "vsc", quantity: 1000, price: 0.72, amount: 720, currency: "USD", createdAt: "4", updatedAt: "" },
      ],
      assets: [asset],
      accounts: [{ id: "cocos", name: "Cocos", broker: "cocos", currency: "USD", createdAt: "" }],
      priceSeries: [],
      quotes: [{ assetId: "vsc", price: 1080, currency: "ARS", at: "2026-09-29", source: "byma" }],
      fxRates: [{ date: "2026-01-01", arsPerUsd: 1500 }],
      asOf: "2026-09-29",
    });
    expect(p.positions).toHaveLength(1);
    expect(p.positions[0].quantity).toBe(2000);
    expect(p.totalPnlUsd).toBeCloseTo(0, 6);
  });
});
