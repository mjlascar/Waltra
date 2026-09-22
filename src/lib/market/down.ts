import type { QuoteResult } from "@/lib/market";

const PROVEEDOR: Record<string, string> = {
  binance: "Binance",
  yahoo: "Yahoo Finance",
  byma: "data912",
};

/**
 * Que proveedores estan caidos, deducido de la propia sincronizacion.
 *
 * Un proveedor se da por caido solo si fallaron TODOS sus activos: que un
 * ticker suelto no cotice es un problema de ese ticker (mal escrito, delistado)
 * y ya se avisa aparte con `missingPrices`.
 *
 * Sale gratis: no hace falta pedirle nada a nadie, los errores ya vienen en la
 * respuesta.
 */
export function proveedoresCaidos(quotes: Pick<QuoteResult, "source" | "price">[]): string[] {
  const total = new Map<string, number>();
  const fallados = new Map<string, number>();
  for (const q of quotes) {
    if (q.source === "manual") continue;
    total.set(q.source, (total.get(q.source) ?? 0) + 1);
    if (q.price === null) fallados.set(q.source, (fallados.get(q.source) ?? 0) + 1);
  }
  const caidos: string[] = [];
  for (const [source, n] of total) {
    if (n > 0 && fallados.get(source) === n) caidos.push(PROVEEDOR[source] ?? source);
  }
  return caidos;
}