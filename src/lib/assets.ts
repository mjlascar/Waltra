import type { Asset, Currency } from "@/lib/types";
import { lookupCatalog, type CatalogEntry } from "@/lib/catalog";

/**
 * Crea la definicion de un activo a partir de un simbolo suelto.
 *
 * Si esta en el catalogo usamos su proveedor y su moneda; si no, apostamos a
 * Yahoo, que es el que mas cobertura tiene, y el usuario lo corrige desde
 * Ajustes si hace falta.
 */
export function assetFromSymbol(
  symbol: string,
  id: string,
  options: { catalog?: CatalogEntry; currency?: Currency } = {},
): Asset {
  const clean = symbol.trim().toUpperCase();
  const entry = options.catalog ?? lookupCatalog(clean);
  if (entry) {
    return {
      id,
      symbol: entry.symbol,
      name: entry.name,
      kind: entry.kind,
      currency: entry.currency,
      source: entry.source,
      sourceSymbol: entry.sourceSymbol,
      precision: entry.precision,
    };
  }
  return {
    id,
    symbol: clean,
    name: clean,
    kind: "stock",
    currency: options.currency ?? "USD",
    source: "yahoo",
    sourceSymbol: clean,
    precision: 6,
  };
}

/** Busca un activo ya cargado por simbolo, sin distinguir mayusculas. */
export function findAssetBySymbol(assets: Asset[], symbol: string): Asset | undefined {
  const clean = symbol.trim().toUpperCase();
  return assets.find((a) => a.symbol.toUpperCase() === clean);
}

/**
 * La cuenta que conviene proponer: la ultima que uso el usuario. En la
 * practica uno carga varios movimientos seguidos del mismo lado, y la primera
 * cuenta por orden alfabetico casi nunca es la que quiere.
 */
export function lastUsedAccountId(
  transactions: { date: string; createdAt: string; accountId: string }[],
  accounts: { id: string }[],
): string {
  const sorted = [...transactions].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt.localeCompare(b.createdAt),
  );
  const last = sorted[sorted.length - 1];
  if (last && accounts.some((a) => a.id === last.accountId)) return last.accountId;
  return accounts[0]?.id ?? "";
}
