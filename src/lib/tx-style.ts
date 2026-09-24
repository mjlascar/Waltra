import type { TxType } from "@/lib/types";

/**
 * Un color por tipo de movimiento, para poder barrer la lista con la vista.
 *
 * Los colores salen de la paleta de series, que ya esta validada para esta
 * superficie (contraste, croma, separacion bajo daltonismo). Se usan como
 * etiquetas fijas y no como serie: cada tipo tiene el suyo y no rota.
 *
 * Deliberadamente NO se usa el verde de ganancia ni el rojo de perdida para
 * los movimientos de capital. Un ingreso no es una ganancia, y pintarlo del
 * color de la ganancia seria contradecir de un plumazo la razon de existir de
 * la app. El rojo queda para la comision, que si es una perdida de verdad.
 *
 * El color nunca va solo: al lado esta siempre el rotulo del tipo.
 */
export const TX_COLOR: Record<TxType, string> = {
  buy: "var(--color-s3)",
  sell: "var(--color-s2)",
  deposit: "var(--color-s1)",
  withdraw: "var(--color-s6)",
  dividend: "var(--color-s4)",
  interest: "var(--color-s4)",
  fee: "var(--color-neg)",
  // Una transferencia no cambia el patrimonio: no merece color propio.
  transfer: "var(--color-ink-3)",
  // Cambiar pesos por dolares tampoco: es la misma plata en otra moneda.
  exchange: "var(--color-ink-3)",
  // Un cambio de ratio tampoco: son las mismas acciones contadas distinto.
  split: "var(--color-ink-3)",
};

export function txColor(type: TxType): string {
  return TX_COLOR[type] ?? "var(--color-ink-3)";
}
