/** Utilidades de escala y trazado para los graficos SVG hechos a mano. */

export interface Box {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function plotArea(box: Box) {
  return {
    x0: box.left,
    y0: box.top,
    x1: box.width - box.right,
    y1: box.height - box.bottom,
    w: box.width - box.left - box.right,
    h: box.height - box.top - box.bottom,
  };
}

export function linear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  return (value: number) => (span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0));
}

/** Marcas "lindas" en el eje: 0, 1.000, 2.000 en vez de 0, 1.234, 2.468. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const span = max - min;
  const rawStep = span / Math.max(1, count);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const step = (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * magnitude;
  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = first; v <= max + step * 1e-9; v += step) {
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

/** Deja aire arriba y abajo para que la linea no toque los bordes. */
export function padDomain(min: number, max: number, pad = 0.08): [number, number] {
  if (min === max) {
    const delta = Math.abs(min) * 0.1 || 1;
    return [min - delta, max + delta];
  }
  const span = max - min;
  return [min - span * pad, max + span * pad];
}

export function linePath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
}

/** Linea escalonada: el capital aportado cambia de golpe, no en rampa. */
export function stepPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  let d = `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L${points[i].x.toFixed(2)} ${points[i - 1].y.toFixed(2)}`;
    d += ` L${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
  }
  return d;
}

export function areaPath(points: { x: number; y: number }[], baseline: number): string {
  if (points.length === 0) return "";
  const top = linePath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${top} L${last.x.toFixed(2)} ${baseline.toFixed(2)} L${first.x.toFixed(2)} ${baseline.toFixed(2)} Z`;
}

/**
 * Reduce una serie larga a como mucho `max` puntos conservando los extremos
 * de cada tramo, asi los picos no desaparecen al muestrear.
 */
export function downsample<T extends { value: number }>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const bucket = points.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.min(points.length, Math.floor((i + 1) * bucket));
    if (end <= start) continue;
    let lo = points[start];
    let hi = points[start];
    for (let j = start; j < end; j++) {
      if (points[j].value < lo.value) lo = points[j];
      if (points[j].value > hi.value) hi = points[j];
    }
    const first = points[start];
    const last = points[end - 1];
    // Mantenemos el orden temporal dentro del tramo.
    const picked = [first, lo, hi, last].filter((p, idx, arr) => arr.indexOf(p) === idx);
    picked.sort((a, b) => points.indexOf(a) - points.indexOf(b));
    out.push(...picked);
  }
  return out;
}
