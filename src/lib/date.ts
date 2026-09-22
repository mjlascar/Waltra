/** Utilidades de fecha. Todo se maneja como YYYY-MM-DD en UTC para que el
 *  ordenamiento lexicografico coincida con el cronologico y no haya sorpresas
 *  por zona horaria. */

export type DayKey = string; // YYYY-MM-DD

export function toDay(value: string | Date): DayKey {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

/**
 * El dia de hoy segun el reloj del telefono, no segun UTC.
 *
 * Importa mas de lo que parece: en Argentina (UTC-3), entre las 21 y la
 * medianoche `toISOString()` ya devuelve la fecha de manana. Alguien que carga
 * sus movimientos de noche veria todo fechado un dia adelante.
 */
export function today(now: Date = new Date()): DayKey {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dayToUtc(day: DayKey): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

export function addDays(day: DayKey, n: number): DayKey {
  return toDay(new Date(dayToUtc(day) + n * 86_400_000));
}

export function daysBetween(a: DayKey, b: DayKey): number {
  return Math.round((dayToUtc(b) - dayToUtc(a)) / 86_400_000);
}

/** Todos los dias entre `from` y `to`, ambos incluidos. */
export function dayRange(from: DayKey, to: DayKey): DayKey[] {
  const out: DayKey[] = [];
  if (daysBetween(from, to) < 0) return out;
  for (let d = from; ; d = addDays(d, 1)) {
    out.push(d);
    if (d === to) break;
    // Guarda de seguridad: 60 anios de serie diaria.
    if (out.length > 22_000) break;
  }
  return out;
}

export function minDay(a: DayKey, b: DayKey): DayKey {
  return a < b ? a : b;
}

export function maxDay(a: DayKey, b: DayKey): DayKey {
  return a > b ? a : b;
}

/** Resta un periodo relativo a hoy: "7D", "1M", "3M", "6M", "1A", "YTD", "MAX". */
export type RangeKey = "7D" | "1M" | "3M" | "6M" | "1A" | "YTD" | "MAX";

export function rangeStart(range: RangeKey, first: DayKey, end: DayKey = today()): DayKey {
  if (range === "MAX") return first;
  if (range === "YTD") return maxDay(first, `${end.slice(0, 4)}-01-01`);
  if (range === "7D") return maxDay(first, addDays(end, -7));
  const months = range === "1M" ? 1 : range === "3M" ? 3 : range === "6M" ? 6 : 12;
  const d = new Date(dayToUtc(end));
  d.setUTCMonth(d.getUTCMonth() - months);
  return maxDay(first, toDay(d));
}
