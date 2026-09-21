import type { DayKey } from "@/lib/date";
import { daysBetween } from "@/lib/date";

export interface DailyPoint {
  day: DayKey;
  /** Valor total del portafolio al cierre, en USD. */
  nav: number;
  /** Capital externo que entro (o salio) ese dia, en USD. */
  flow: number;
}

export interface TwrPoint {
  day: DayKey;
  /** Indice base 100 el primer dia con capital. */
  index: number;
  /** Retorno acumulado desde el inicio, en tanto por uno. */
  cumulative: number;
}

/**
 * Retorno time-weighted: encadena los retornos diarios neutralizando los
 * aportes.
 *
 * Convencion: el flujo del dia se asienta al CIERRE, asi que el capital que
 * trabajo durante el dia es el del cierre anterior:
 *
 *     r = (nav_hoy - flujo_hoy) / nav_ayer - 1
 *
 * Es la convencion estandar para series diarias y es la correcta para este
 * caso de uso: la plata que depositas hoy no rindio hoy. Con la convencion
 * opuesta (flujo al inicio), un deposito hecho el mismo dia que el mercado se
 * mueve diluye el retorno de ese dia y el numero deja de ser comparable.
 *
 * Esta es la metrica que responde "que tan bien elegi", sin que la inyeccion
 * de capital la ensucie.
 */
export function timeWeightedReturn(points: DailyPoint[]): TwrPoint[] {
  const out: TwrPoint[] = [];
  let index = 100;
  let prevNav: number | null = null;

  for (const p of points) {
    if (prevNav === null) {
      // Arrancamos el indice el primer dia en que hay algo en juego. Ese dia
      // no tiene retorno medible: no habia capital previo contra el cual medir.
      if (p.nav > 0 || p.flow !== 0) {
        prevNav = p.nav;
        out.push({ day: p.day, index, cumulative: 0 });
      }
      continue;
    }
    // Sin capital al cierre anterior no hay retorno que medir (por ejemplo,
    // el usuario retiro todo y volvio a entrar mas tarde).
    const r = prevNav > 1e-9 ? (p.nav - p.flow) / prevNav - 1 : 0;
    index *= 1 + r;
    out.push({ day: p.day, index, cumulative: index / 100 - 1 });
    prevNav = p.nav;
  }
  return out;
}

export interface CashFlow {
  day: DayKey;
  /** Negativo = plata que el usuario pone; positivo = plata que recibe. */
  amount: number;
}

function npv(flows: CashFlow[], rate: number, base: DayKey): number {
  let total = 0;
  for (const f of flows) {
    const years = daysBetween(base, f.day) / 365;
    total += f.amount / Math.pow(1 + rate, years);
  }
  return total;
}

/**
 * Tasa interna de retorno con fechas irregulares (XIRR). Newton-Raphson con
 * bisection de respaldo, porque Newton solo diverge feo en carteras chicas.
 * Devuelve null si no hay senal suficiente (todos los flujos del mismo signo).
 */
export function xirr(flows: CashFlow[]): number | null {
  if (flows.length < 2) return null;
  const sorted = [...flows].sort((a, b) => (a.day < b.day ? -1 : 1));
  const base = sorted[0].day;
  const hasNeg = sorted.some((f) => f.amount < 0);
  const hasPos = sorted.some((f) => f.amount > 0);
  if (!hasNeg || !hasPos) return null;

  let rate = 0.1;
  for (let i = 0; i < 80; i++) {
    const value = npv(sorted, rate, base);
    if (!Number.isFinite(value)) break;
    if (Math.abs(value) < 1e-7) return rate;
    const h = 1e-5;
    const derivative = (npv(sorted, rate + h, base) - value) / h;
    if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-12) break;
    const next = rate - value / derivative;
    if (!Number.isFinite(next) || next <= -0.9999) break;
    if (Math.abs(next - rate) < 1e-9) return next;
    rate = next;
  }

  // Respaldo: bisection en un rango amplio pero acotado (-99% a +10000%).
  let lo = -0.9999;
  let hi = 100;
  let fLo = npv(sorted, lo, base);
  let fHi = npv(sorted, hi, base);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(sorted, mid, base);
    if (Math.abs(fMid) < 1e-9) return mid;
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  void fHi;
  return (lo + hi) / 2;
}

/** Convierte un retorno acumulado a tasa anualizada. */
export function annualize(cumulative: number, days: number): number | null {
  if (days < 30) return null;
  const years = days / 365;
  const growth = 1 + cumulative;
  if (growth <= 0) return null;
  return Math.pow(growth, 1 / years) - 1;
}

/** Volatilidad anualizada a partir de los retornos diarios del indice TWR. */
export function volatility(points: TwrPoint[]): number | null {
  if (points.length < 20) return null;
  const rets: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].index;
    if (prev > 0) rets.push(points[i].index / prev - 1);
  }
  if (rets.length < 20) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

/** Maxima caida desde un pico previo, en tanto por uno (valor negativo). */
export function maxDrawdown(points: TwrPoint[]): { value: number; from?: DayKey; to?: DayKey } {
  let peak = -Infinity;
  let peakDay: DayKey | undefined;
  let worst = 0;
  let from: DayKey | undefined;
  let to: DayKey | undefined;
  for (const p of points) {
    if (p.index > peak) {
      peak = p.index;
      peakDay = p.day;
    }
    if (peak > 0) {
      const dd = p.index / peak - 1;
      if (dd < worst) {
        worst = dd;
        from = peakDay;
        to = p.day;
      }
    }
  }
  return { value: worst, from, to };
}
