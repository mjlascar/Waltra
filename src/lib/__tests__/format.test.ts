import { describe, expect, it } from "vitest";
import { money, percent, quantity, relativeDate, relativeTime, shortDate } from "@/lib/format";

/** El espacio entre simbolo y numero es duro, para que nunca corte de renglon. */
const plain = (s: string) => s.replace(/ /g, " ");

describe("money", () => {
  it("usa formato argentino", () => {
    expect(plain(money(1234.5))).toBe("US$ 1.235");
    expect(plain(money(12.34))).toBe("US$ 12,34");
    expect(plain(money(0.0025))).toBe("US$ 0,0025");
  });

  it("marca el signo cuando se lo pide", () => {
    expect(plain(money(50, "USD", { sign: true }))).toBe("+US$ 50,00");
    expect(plain(money(-50, "USD", { sign: true }))).toBe("-US$ 50,00");
  });

  it("compacta los numeros grandes", () => {
    expect(plain(money(15_400, "USD", { compact: true }))).toBe("US$ 15,4k");
    expect(plain(money(2_400_000, "USD", { compact: true }))).toBe("US$ 2,4M");
    // Por debajo del umbral no compacta: perder precision ahi molesta.
    expect(plain(money(9_999, "USD", { compact: true }))).toBe("US$ 9.999");
  });

  it("distingue pesos de dolares", () => {
    expect(plain(money(1000, "ARS"))).toBe("$ 1.000");
  });

  it("no inventa un numero cuando no hay dato", () => {
    expect(money(null)).toBe("—");
    expect(money(undefined)).toBe("—");
    expect(money(NaN)).toBe("—");
  });
});

describe("percent", () => {
  it("formatea con signo", () => {
    expect(percent(0.1234)).toBe("+12,3%");
    expect(percent(-0.05)).toBe("-5,0%");
    expect(percent(0)).toBe("0,0%");
  });

  it("baja la precision cuando el numero es grande", () => {
    expect(percent(1.5)).toBe("+150%");
  });

  it("sin dato devuelve raya", () => {
    expect(percent(null)).toBe("—");
  });
});

describe("quantity", () => {
  it("no rellena con ceros inutiles", () => {
    expect(quantity(2)).toBe("2");
    expect(quantity(0.5)).toBe("0,5");
    expect(quantity(0.00012345, 8)).toBe("0,00012345");
    expect(quantity(1234.5678)).toBe("1.235");
  });
});

describe("fechas", () => {
  it("fecha corta sin anio si es de este anio", () => {
    const year = new Date().getUTCFullYear();
    expect(plain(shortDate(`${year}-03-05`))).toBe("5 mar");
    expect(plain(shortDate("2019-03-05"))).toBe("5 mar 2019");
  });

  it("fechas relativas en castellano", () => {
    const now = new Date("2026-06-15T12:00:00.000Z");
    expect(relativeDate("2026-06-15", now)).toBe("hoy");
    expect(relativeDate("2026-06-14", now)).toBe("ayer");
    expect(relativeDate("2026-06-05", now)).toBe("hace 10 días");
    expect(relativeDate("2026-03-15", now)).toBe("hace 3 meses");
    expect(relativeDate("2024-06-15", now)).toBe("hace 2 años");
  });

  it("hora relativa corta", () => {
    const now = new Date("2026-06-15T12:00:00.000Z");
    expect(relativeTime("2026-06-15T11:59:50.000Z", now)).toBe("hace un momento");
    expect(relativeTime("2026-06-15T11:30:00.000Z", now)).toBe("hace 30 min");
    expect(relativeTime("2026-06-15T08:00:00.000Z", now)).toBe("hace 4 h");
    expect(relativeTime("2026-06-12T12:00:00.000Z", now)).toBe("hace 3 d");
  });
});

describe("hoy es el dia del telefono, no el de UTC", () => {
  it("de noche en Argentina no adelanta un dia", async () => {
    const { today } = await import("@/lib/date");
    // 21:30 del 15 de junio en Buenos Aires ya es 16 de junio en UTC.
    const noche = new Date(2026, 5, 15, 21, 30, 0);
    expect(today(noche)).toBe("2026-06-15");
    expect(noche.toISOString().slice(0, 10)).not.toBe("2026-06-15");
  });

  it("relativeDate usa la misma referencia local", () => {
    const noche = new Date(2026, 5, 15, 22, 0, 0);
    expect(relativeDate("2026-06-15", noche)).toBe("hoy");
    expect(relativeDate("2026-06-14", noche)).toBe("ayer");
  });
});
