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

/**
 * La especie, sin la letra de la moneda en que se opera.
 *
 * VSCYO y VSCYD son la misma ON de Vista: la O se opera en pesos y la D en
 * dolar MEP (C es cable). AL30 y AL30D, lo mismo con el bono soberano, donde
 * la version en pesos no lleva letra. Cargadas por separado aparecian como
 * dos bonos distintos; son una sola tenencia comprada de dos maneras.
 */
export function bondBase(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  return s.length >= 5 && /[ODC]$/.test(s) ? s.slice(0, -1) : s;
}

/** El bono ya cargado que es la misma especie, si hay. */
export function sameBond<T extends { symbol: string; kind: string; archived?: boolean }>(
  assets: T[],
  symbol: string,
): T | undefined {
  const base = bondBase(symbol);
  return assets.find((a) => a.kind === "bond" && !a.archived && bondBase(a.symbol) === base);
}

/**
 * Bonos cargados dos veces con distinta letra de moneda. Se queda primero la
 * version en pesos: es la que mas opera y la que el resto de la app valua al
 * dolar del dia, igual que un CEDEAR comprado en dolares.
 */
export function duplicateBonds<T extends { symbol: string; kind: string; currency: string; archived?: boolean }>(
  assets: T[],
): T[][] {
  const grupos = new Map<string, T[]>();
  for (const a of assets) {
    if (a.kind !== "bond" || a.archived) continue;
    const base = bondBase(a.symbol);
    grupos.set(base, [...(grupos.get(base) ?? []), a]);
  }
  return [...grupos.values()]
    .filter((g) => g.length > 1)
    .map((g) => [...g].sort((a, b) => (a.currency === "ARS" ? -1 : 0) - (b.currency === "ARS" ? -1 : 0)));
}
