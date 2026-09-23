import { describe, expect, it } from "vitest";
import { bandRuns } from "@/components/charts/scale";

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
