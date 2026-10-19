import { describe, expect, it } from "vitest";
import { annualize, maxDrawdown, timeWeightedReturn, volatility, xirr } from "@/lib/engine/returns";

describe("timeWeightedReturn", () => {
  it("devuelve 0 cuando solo hubo aportes", () => {
    const twr = timeWeightedReturn([
      { day: "2024-01-01", nav: 100, flow: 100 },
      { day: "2024-01-02", nav: 100, flow: 0 },
      { day: "2024-01-03", nav: 200, flow: 100 },
    ]);
    expect(twr.at(-1)!.cumulative).toBeCloseTo(0);
  });

  it("encadena retornos independientes del tamanio de la cartera", () => {
    const twr = timeWeightedReturn([
      { day: "2024-01-01", nav: 100, flow: 100 },
      { day: "2024-01-02", nav: 110, flow: 0 }, // +10%
      { day: "2024-01-03", nav: 1110, flow: 1000 }, // aporte, precio quieto
      { day: "2024-01-04", nav: 1221, flow: 0 }, // +10%
    ]);
    expect(twr.at(-1)!.cumulative).toBeCloseTo(0.21, 6);
  });

  it("un dia sin capital en riesgo no rompe el indice", () => {
    const twr = timeWeightedReturn([
      { day: "2024-01-01", nav: 0, flow: 0 },
      { day: "2024-01-02", nav: 100, flow: 100 },
      { day: "2024-01-03", nav: 120, flow: 0 },
    ]);
    expect(Number.isFinite(twr.at(-1)!.cumulative)).toBe(true);
    expect(twr.at(-1)!.cumulative).toBeCloseTo(0.2);
  });
});

describe("timeWeightedReturn con días casi sin capital", () => {
  // El caso real: compras cargadas antes que el ingreso que las pagó dejan el
  // efectivo en negativo, y la cartera vale casi cero esos días. Dividir por
  // ese casi cero daba un rendimiento de miles por ciento negativo, el índice
  // cruzaba a negativo y el TWR desaparecía de la pantalla para siempre.
  // 300 en activos y -299,6 de efectivo: la cartera "vale" 0,40.
  const casiCero = [
    { day: "2024-01-01", nav: 0.4, flow: 0, invested: 300 },
    { day: "2024-01-02", nav: -3, flow: 0, invested: 296.6 },
    { day: "2024-01-03", nav: 1000, flow: 1003, invested: 1000 },
    { day: "2024-01-04", nav: 1100, flow: 0, invested: 1100 },
  ];

  it("no deja el índice en negativo", () => {
    const twr = timeWeightedReturn(casiCero);
    for (const p of twr) expect(p.index).toBeGreaterThan(0);
  });

  it("mide lo que pasó con capital de verdad", () => {
    const twr = timeWeightedReturn(casiCero);
    expect(twr.at(-1)!.cumulative).toBeCloseTo(0.1, 6);
  });

  it("un día que pierde todo no apaga el índice para siempre", () => {
    const twr = timeWeightedReturn([
      { day: "2024-01-01", nav: 100, flow: 100 },
      { day: "2024-01-02", nav: 0, flow: 0 },
      { day: "2024-01-03", nav: 100, flow: 100 },
      { day: "2024-01-04", nav: 110, flow: 0 },
    ]);
    for (const p of twr) expect(Number.isFinite(p.index)).toBe(true);
    expect(twr.at(-1)!.index).toBeGreaterThan(0);
  });
});

describe("xirr", () => {
  it("resuelve un 10% anual simple", () => {
    const r = xirr([
      { day: "2024-01-01", amount: -100 },
      { day: "2024-12-31", amount: 110 },
    ]);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.1, 2);
  });

  it("maneja aportes escalonados", () => {
    const r = xirr([
      { day: "2023-01-01", amount: -1000 },
      { day: "2023-07-01", amount: -1000 },
      { day: "2024-01-01", amount: 2100 },
    ]);
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(0.05);
    expect(r!).toBeLessThan(0.2);
  });

  it("devuelve null si todos los flujos van en el mismo sentido", () => {
    expect(
      xirr([
        { day: "2024-01-01", amount: -100 },
        { day: "2024-06-01", amount: -100 },
      ]),
    ).toBeNull();
  });

  it("tolera perdidas grandes", () => {
    const r = xirr([
      { day: "2024-01-01", amount: -1000 },
      { day: "2024-12-31", amount: 400 },
    ]);
    expect(r).not.toBeNull();
    expect(r!).toBeLessThan(-0.5);
  });
});

describe("metricas de riesgo", () => {
  it("annualize compone correctamente", () => {
    expect(annualize(0.21, 730)).toBeCloseTo(0.1, 3);
    expect(annualize(0.5, 10)).toBeNull(); // muy poca historia
  });

  it("maxDrawdown encuentra la peor caida", () => {
    const dd = maxDrawdown([
      { day: "2024-01-01", index: 100, cumulative: 0 },
      { day: "2024-01-02", index: 120, cumulative: 0.2 },
      { day: "2024-01-03", index: 90, cumulative: -0.1 },
      { day: "2024-01-04", index: 130, cumulative: 0.3 },
    ]);
    expect(dd.value).toBeCloseTo(-0.25);
    expect(dd.from).toBe("2024-01-02");
    expect(dd.to).toBe("2024-01-03");
  });

  it("volatility pide historia suficiente", () => {
    expect(volatility([{ day: "2024-01-01", index: 100, cumulative: 0 }])).toBeNull();
  });
});
