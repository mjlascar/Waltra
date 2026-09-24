import { describe, expect, it } from "vitest";
import { bandRuns, fitDomain, niceTicks } from "@/components/charts/scale";
import { axisMoney } from "@/lib/format";

/**
 * La banda entre el valor y el capital es la ganancia dibujada, así que
 * pintarla del color equivocado diría lo contrario de lo que pasó. Estos tests
 * fijan de qué lado queda cada tramo.
 *
 * Ojo con el signo: en coordenadas de pantalla la y crece hacia ABAJO, así que
 * "ir arriba" —ganar— es tener la y más chica.
 */
const pts = (ys: number[]) => ys.map((y, x) => ({ x, y }));

describe("bandRuns", () => {
  it("una serie siempre por encima es un solo tramo de ganancia", () => {
    const runs = bandRuns(pts([10, 10, 10]), pts([20, 20, 20]));
    expect(runs).toHaveLength(1);
    expect(runs[0].gain).toBe(true);
  });

  it("una serie siempre por debajo es un solo tramo de pérdida", () => {
    const runs = bandRuns(pts([30, 30, 30]), pts([20, 20, 20]));
    expect(runs).toHaveLength(1);
    expect(runs[0].gain).toBe(false);
  });

  it("al cruzarse se parte en dos tramos de distinto signo", () => {
    // Arranca abajo (pierde) y termina arriba (gana).
    const runs = bandRuns(pts([30, 10]), pts([20, 20]));
    expect(runs).toHaveLength(2);
    expect(runs[0].gain).toBe(false);
    expect(runs[1].gain).toBe(true);
  });

  it("el corte cae en el cruce real, no en el punto siguiente", () => {
    // Cruza justo en la mitad: de +10 a −10 respecto de la referencia.
    const runs = bandRuns(pts([30, 10]), pts([20, 20]));
    // Los dos tramos comparten el punto de cruce, en x = 0,5.
    expect(runs[0].path).toContain("0.50 20.00");
    expect(runs[1].path.startsWith("M0.50 20.00")).toBe(true);
  });

  it("cada tramo cierra la figura", () => {
    for (const run of bandRuns(pts([30, 10, 30]), pts([20, 20, 20]))) {
      expect(run.path.endsWith("Z")).toBe(true);
    }
  });

  it("sin dos puntos no hay banda", () => {
    expect(bandRuns(pts([10]), pts([20]))).toEqual([]);
    expect(bandRuns([], [])).toEqual([]);
  });

  it("no se cuelga si las series tienen distinto largo", () => {
    expect(bandRuns(pts([10, 10, 10]), pts([20, 20]))).toHaveLength(1);
  });
});

describe("el eje del gráfico principal", () => {
  it("se ajusta a los datos y no arranca en cero", () => {
    // Un mes de una cartera de diez mil que se movió 300.
    const [lo, hi] = fitDomain(9_800, 10_100);
    expect(lo).toBeGreaterThan(9_700);
    expect(hi).toBeLessThan(10_200);
  });

  it("un rango mínimo evita que dos dólares parezcan una montaña rusa", () => {
    const [lo, hi] = fitDomain(10_000, 10_002);
    expect(hi - lo).toBeGreaterThanOrEqual(50);
  });

  it("una serie plana tiene alto", () => {
    const [lo, hi] = fitDomain(0, 0);
    expect(hi).toBeGreaterThan(lo);
  });

  it("marcas cercanas no se escriben iguales", () => {
    const [lo, hi] = fitDomain(10_020, 10_180);
    const ticks = niceTicks(lo, hi, 3).filter((t) => t >= lo && t <= hi);
    const step = ticks[1] - ticks[0];
    const largest = Math.max(...ticks);
    const labels = ticks.map((t) => axisMoney(t, step, largest));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("todas las marcas en la misma unidad", () => {
    // El espacio despues del simbolo es uno que no parte la linea.
    const label = (v: number, step: number, largest: number) =>
      axisMoney(v, step, largest).replace(/\u00a0/g, " ");
    expect(label(9_800, 200, 10_200)).toBe("US$ 9,8k");
    expect(label(10_000, 200, 10_200)).toBe("US$ 10,0k");
    expect(label(10_050, 50, 10_100)).toBe("US$ 10,05k");
    expect(label(2_000, 1_000, 3_000)).toBe("US$ 2.000");
    expect(label(150_000, 50_000, 200_000)).toBe("US$ 150k");
  });
});
