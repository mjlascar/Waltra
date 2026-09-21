import type { DayKey } from "@/lib/date";
import { addDays, today } from "@/lib/date";

const MONTHS: Record<string, number> = {
  ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4,
  may: 5, mayo: 5, jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8,
  sep: 9, sept: 9, septiembre: 9, set: 9, oct: 10, octubre: 10,
  nov: 11, noviembre: 11, dic: 12, diciembre: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

export interface DateMatch {
  day: DayKey;
  /** Tramo del texto que consumio, para poder borrarlo antes de seguir. */
  match: string;
}

/**
 * Busca una fecha en lenguaje natural. Formato argentino: dia/mes/anio.
 * Si no encuentra nada, devuelve null y el llamador usa hoy.
 */
export function extractDate(text: string, now: DayKey = today()): DateMatch | null {
  const lower = text.toLowerCase();

  const relative: [RegExp, number][] = [
    [/\bhoy\b/, 0],
    [/\bayer\b/, -1],
    [/\banteayer\b|\bantes de ayer\b/, -2],
  ];
  for (const [re, offset] of relative) {
    const m = lower.match(re);
    if (m) return { day: addDays(now, offset), match: m[0] };
  }

  const ago = lower.match(/\bhace\s+(\d{1,4})\s*(d[ií]as?|semanas?|meses?|a[nñ]os?)\b/);
  if (ago) {
    const n = Number(ago[1]);
    const unit = ago[2];
    const days = unit.startsWith("sem") ? n * 7 : unit.startsWith("mes") ? n * 30 : unit.startsWith("a") ? n * 365 : n;
    return { day: addDays(now, -days), match: ago[0] };
  }

  // 2024-03-12
  const iso = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return { day: `${iso[1]}-${iso[2]}-${iso[3]}`, match: iso[0] };

  // 12/3, 12/3/24, 12-03-2024
  const dmy = lower.match(/\b(\d{1,2})[/\-](\d{1,2})(?:[/\-](\d{2,4}))?\b/);
  if (dmy) {
    const d = Number(dmy[1]);
    const mo = Number(dmy[2]);
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      let year = dmy[3] ? Number(dmy[3]) : Number(now.slice(0, 4));
      if (year < 100) year += 2000;
      let day = `${year}-${pad(mo)}-${pad(d)}`;
      // Sin anio explicito, una fecha futura casi siempre es del anio pasado.
      if (!dmy[3] && day > now) day = `${year - 1}-${pad(mo)}-${pad(d)}`;
      return { day, match: dmy[0] };
    }
  }

  // "12 de marzo", "3 mar 2024"
  const named = lower.match(
    /\b(\d{1,2})\s*(?:de\s+)?([a-záéíóúñ]{3,10})\.?(?:\s+(?:de\s+)?(\d{4}))?\b/,
  );
  if (named) {
    const mo = MONTHS[named[2].replace(/\./g, "")];
    const d = Number(named[1]);
    if (mo && d >= 1 && d <= 31) {
      const year = named[3] ? Number(named[3]) : Number(now.slice(0, 4));
      let day = `${year}-${pad(mo)}-${pad(d)}`;
      if (!named[3] && day > now) day = `${year - 1}-${pad(mo)}-${pad(d)}`;
      return { day, match: named[0] };
    }
  }

  return null;
}
