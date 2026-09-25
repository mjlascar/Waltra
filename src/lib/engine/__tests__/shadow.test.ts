import { describe, expect, it } from "vitest";
import { shadowComparison } from "@/lib/engine/shadow";
import { addMonths } from "@/lib/date";
import type { DailyPoint } from "@/lib/engine/returns";

/** Días seguidos desde el 1 de enero. */
const dia = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);

describe("con tus aportes", () => {
  /**
   * El caso que motivó esto: US$ 100 el primer día, US$ 1.000 más a mitad de
   * camino, y el índice que duplica en la primera mitad y queda quieto en la
   * segunda. Comprado entero el primer día, el índice "hace +100%"; pero los
   * US$ 1.000 que entraron después no ganaron nada. Con la misma plata en las
   * mismas fechas, el índice deja US$ 1.200: +9%.
   */
  const precio = (d: string) => (d < dia(10) ? 100 : 200);
  const daily: DailyPoint[] = Array.from({ length: 20 }, (_, i) => ({
    day: dia(i),
    // La cartera que no hizo nada: vale lo que se puso.
    nav: i < 10 ? 100 : 1100,
    flow: i === 0 ? 100 : i === 10 ? 1000 : 0,
  }));

  it("la sombra compra con cada aporte, al precio de ese día", () => {
    const r = shadowComparison(daily, precio, "aportes")!;
    expect(r.theirsValue).toBeCloseTo(1200, 6);
    expect(r.capital).toBe(1100);
    expect(r.theirs[r.theirs.length - 1].value).toBeCloseTo(100 / 1100, 6);
  });

  it("y tu cartera se mide igual: ganancia sobre lo puesto", () => {
    const r = shadowComparison(daily, precio, "aportes")!;
    expect(r.mine.every((p) => p.value === 0)).toBe(true);
    expect(r.mineValue).toBe(1100);
  });

  it("si la cartera es el índice, las dos curvas son la misma", () => {
    const igual = daily.map((d, i) => ({
      ...d,
      nav: i < 10 ? 100 : 200 + 1000,
    }));
    const r = shadowComparison(igual, precio, "aportes")!;
    for (let i = 0; i < r.mine.length; i++) {
      expect(r.mine[i].value).toBeCloseTo(r.theirs[i].value, 9);
    }
  });

  it("un retiro vende índice, y no deja la sombra en negativo", () => {
    const conRetiro = [
      { day: dia(0), nav: 100, flow: 100 },
      { day: dia(1), nav: 100, flow: 0 },
      { day: dia(2), nav: 0, flow: -500 },
    ];
    const r = shadowComparison(conRetiro, () => 100, "aportes")!;
    expect(r.theirsValue).toBeCloseTo(0, 9);
  });

  it("sin precio del índice no inventa nada", () => {
    expect(shadowComparison(daily, () => null, "aportes")).toBeNull();
  });
});

describe("mensual", () => {
  it("reparte el capital total en cuotas iguales, una por mes", () => {
    // Tres meses y un poco: cuatro cuotas de 300 sobre 1.200 aportados.
    const dias = Array.from({ length: 100 }, (_, i) => dia(i));
    const daily: DailyPoint[] = dias.map((d, i) => ({ day: d, nav: 1200, flow: i === 0 ? 1200 : 0 }));
    // El índice sube 10 por mes.
    const precio = (d: string) => 100 + 10 * Number(d.slice(5, 7)) - 10;
    const r = shadowComparison(daily, precio, "mensual")!;
    // 300/100 + 300/110 + 300/120 + 300/130 unidades, a 130.
    const unidades = 3 + 300 / 110 + 300 / 120 + 300 / 130;
    expect(r.theirsValue).toBeCloseTo(unidades * 130, 6);
    expect(r.capital).toBe(1200);
  });

  it("el mes corto no corre la cuota", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });
});
