import type { SymbolHit } from "@/lib/market/search";

/**
 * Bonos y obligaciones negociables del mercado argentino.
 *
 * No estan en el catalogo ni en el buscador de Yahoo, que no conoce las ON
 * locales: comprar VSCYO en Cocos no habia forma de cargarlo. Y cotizan
 * distinto que una accion: el precio es **cada 100 nominales** (una ON a
 * $ 108.000 son $ 1.080 por nominal), asi que el activo lleva `priceUnit` y
 * la cotizacion se pasa a precio por nominal al guardarla. El resto de la app
 * multiplica unidades por precio como siempre.
 *
 * El ultimo caracter del ticker dice la moneda en que se opera la especie:
 * D es dolar MEP, C es cable y cualquier otra (O, la mas comun en ON) pesos.
 */
export const BOND_PRICE_UNIT = 100;

/** Si lo escrito tiene forma de ticker de BYMA: 4 a 6 letras y numeros. */
export function looksLikeBymaTicker(query: string): boolean {
  const q = query.trim().toUpperCase();
  return /^[A-Z][A-Z0-9]{3,5}$/.test(q);
}

export function bondCandidate(query: string): (SymbolHit & { priceUnit: number }) | null {
  const symbol = query.trim().toUpperCase();
  if (!looksLikeBymaTicker(symbol)) return null;
  const enDolares = /[DC]$/.test(symbol);
  return {
    symbol,
    name: `${symbol} · bono u ON`,
    kind: "bond",
    currency: enDolares ? "USD" : "ARS",
    source: "byma",
    sourceSymbol: symbol,
    precision: 0,
    exchange: "BYMA · cada 100 VN",
    priceUnit: BOND_PRICE_UNIT,
  };
}
