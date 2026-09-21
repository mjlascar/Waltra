import type { PriceSeries } from "@/lib/types";
import type { DayKey } from "@/lib/date";

/** Busqueda de precio por fecha con forward-fill (ultimo cierre conocido). */
export class PriceLookup {
  private readonly table = new Map<string, { days: DayKey[]; closes: number[] }>();

  constructor(series: PriceSeries[]) {
    for (const s of series) {
      const points = [...s.points].sort((a, b) => (a.date < b.date ? -1 : 1));
      this.table.set(s.assetId, {
        days: points.map((p) => p.date),
        closes: points.map((p) => p.close),
      });
    }
  }

  has(assetId: string): boolean {
    const e = this.table.get(assetId);
    return !!e && e.days.length > 0;
  }

  firstDay(assetId: string): DayKey | null {
    const e = this.table.get(assetId);
    return e && e.days.length ? e.days[0] : null;
  }

  /** Ultimo cierre conocido en o antes de `day`. null si no hay dato previo. */
  at(assetId: string, day: DayKey): number | null {
    const e = this.table.get(assetId);
    if (!e || e.days.length === 0) return null;
    if (day < e.days[0]) return null;
    let lo = 0;
    let hi = e.days.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (e.days[mid] <= day) lo = mid;
      else hi = mid - 1;
    }
    return e.closes[lo];
  }

  latest(assetId: string): number | null {
    const e = this.table.get(assetId);
    if (!e || e.closes.length === 0) return null;
    return e.closes[e.closes.length - 1];
  }
}
