import type { FxRate } from "@/lib/types";
import type { DayKey } from "@/lib/date";

/**
 * Tabla de tipo de cambio ARS/USD con busqueda "el valor conocido mas cercano
 * hacia atras". Si no hay ningun dato previo usa el primero disponible; si la
 * tabla esta vacia devuelve el fallback.
 */
export class FxTable {
  private readonly days: DayKey[];
  private readonly rates: number[];

  constructor(rows: FxRate[], private readonly fallback = 1) {
    const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : 1));
    this.days = sorted.map((r) => r.date);
    this.rates = sorted.map((r) => r.arsPerUsd);
  }

  get isEmpty(): boolean {
    return this.days.length === 0;
  }

  /** ARS por 1 USD en la fecha dada. */
  at(day: DayKey): number {
    if (this.days.length === 0) return this.fallback;
    let lo = 0;
    let hi = this.days.length - 1;
    if (day < this.days[0]) return this.rates[0];
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.days[mid] <= day) lo = mid;
      else hi = mid - 1;
    }
    return this.rates[lo];
  }

  get latest(): number {
    return this.rates.length ? this.rates[this.rates.length - 1] : this.fallback;
  }
}

/** Convierte un monto a USD. `fx` es ARS por USD en esa fecha. */
export function toUsd(amount: number, currency: "USD" | "ARS", fx: number): number {
  if (currency === "USD") return amount;
  return fx > 0 ? amount / fx : 0;
}
