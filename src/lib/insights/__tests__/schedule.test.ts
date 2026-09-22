import { describe, expect, it } from "vitest";
import {
  describeSchedule,
  isDue,
  lastOccurrence,
  schedules,
  type Schedule,
} from "@/lib/insights/schedule";
import { DEFAULT_SETTINGS } from "@/lib/db";

/**
 * Los tests corren en America/Argentina/Buenos_Aires (vitest.config.ts): las
 * horas son las del reloj del telefono, como en el resto de la app.
 */
const lunes9: Schedule = { kind: "mercado", enabled: true, weekday: 1, hour: 9 };

// 2026-09-21 es lunes.
const el = (dia: number, hora: number, min = 0) => new Date(2026, 8, dia, hora, min, 0);

describe("cuándo tocaba", () => {
  it("el mismo día, después de la hora", () => {
    expect(lastOccurrence(lunes9, el(21, 10)).getTime()).toBe(el(21, 9).getTime());
  });

  it("el mismo día pero antes de la hora manda a la semana anterior", () => {
    expect(lastOccurrence(lunes9, el(21, 8)).getTime()).toBe(el(14, 9).getTime());
  });

  it("a mitad de semana, al lunes que pasó", () => {
    expect(lastOccurrence(lunes9, el(24, 15)).getTime()).toBe(el(21, 9).getTime());
  });

  it("el domingo sigue siendo el lunes anterior", () => {
    expect(lastOccurrence(lunes9, el(27, 12)).getTime()).toBe(el(21, 9).getTime());
  });
});

describe("si toca generarlo", () => {
  it("apagado nunca toca", () => {
    expect(isDue({ ...lunes9, enabled: false }, el(24, 15))).toBe(false);
  });

  it("sin haberlo generado nunca, toca", () => {
    expect(isDue(lunes9, el(21, 10))).toBe(true);
  });

  it("antes de la hora no toca", () => {
    expect(isDue(lunes9, el(21, 8))).toBe(true); // el lunes anterior sigue pendiente
    expect(isDue({ ...lunes9, lastRun: el(14, 9, 30).toISOString() }, el(21, 8))).toBe(false);
  });

  it("generado después de la hora, no vuelve a tocar esa semana", () => {
    const s = { ...lunes9, lastRun: el(21, 9, 5).toISOString() };
    expect(isDue(s, el(21, 10))).toBe(false);
    expect(isDue(s, el(24, 15))).toBe(false);
  });

  it("pero sí a la semana siguiente", () => {
    const s = { ...lunes9, lastRun: el(21, 9, 5).toISOString() };
    expect(isDue(s, el(28, 9, 1))).toBe(true);
  });

  it("generado antes de la hora no cuenta como hecho", () => {
    // Alguien lo genera a mano el lunes temprano; a las 9 igual le toca.
    const s = { ...lunes9, lastRun: el(21, 7).toISOString() };
    expect(isDue(s, el(21, 10))).toBe(true);
  });

  it("una fecha inválida guardada no lo deja trabado para siempre", () => {
    expect(isDue({ ...lunes9, lastRun: "cualquier cosa" }, el(21, 10))).toBe(true);
  });
});

describe("la lista que ve el usuario", () => {
  it("siempre trae las agendables, aunque no haya nada guardado", () => {
    const lista = schedules(DEFAULT_SETTINGS);
    expect(lista.map((s) => s.kind)).toEqual(["mercado", "cartera", "riesgo"]);
    expect(lista.every((s) => !s.enabled)).toBe(true);
  });

  it("lo guardado pisa a la sugerencia, sin perder el orden", () => {
    const guardado: Schedule = { kind: "cartera", enabled: true, weekday: 3, hour: 20 };
    const lista = schedules({ ...DEFAULT_SETTINGS, schedules: [guardado] });
    expect(lista.map((s) => s.kind)).toEqual(["mercado", "cartera", "riesgo"]);
    expect(lista[1]).toEqual(guardado);
  });

  it("los informes de consulta no se agendan: no tiene sentido", async () => {
    const { AGENDABLES } = await import("@/lib/insights/schedule");
    // "Tengo plata, ¿qué hago?" cada lunes no significa nada.
    expect(AGENDABLES).not.toContain("decision");
    expect(AGENDABLES).not.toContain("posicion");
  });
});

describe("cómo se lee", () => {
  it("dice el día y la hora en castellano", () => {
    expect(describeSchedule(lunes9)).toBe("Todos los lunes a las 09:00");
    expect(describeSchedule({ ...lunes9, weekday: 3, hour: 18 })).toBe(
      "Todos los miércoles a las 18:00",
    );
  });
});
