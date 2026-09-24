import type { Asset, Currency, Transaction } from "@/lib/types";
import type { CatalogEntry } from "@/lib/catalog";
import { lookupCatalog } from "@/lib/catalog";
import { assetFromSymbol, findAssetBySymbol } from "@/lib/assets";
import type { WaltraDB } from "@/lib/db";

/**
 * CEDEARs: la misma empresa, otro papel.
 *
 * Un CEDEAR es un certificado que se opera en BYMA, en pesos (o en dólares
 * MEP), y que representa una FRACCIÓN de la acción de EE.UU. El de SPY, por
 * ejemplo, es 20 a 1: veinte CEDEARs equivalen a una acción.
 *
 * Confundirlos no es un detalle de cotización, es un error de unidades. Nueve
 * CEDEARs de SPY comprados a $ 50.705 son unos US$ 300; nueve acciones de SPY
 * son unos US$ 6.000. Registrar lo primero como lo segundo inventa una
 * ganancia de miles de dólares, que es exactamente lo que pasó con la primera
 * compra real cargada en la app.
 *
 * La regla que evita eso: una acción o un ETF de EE.UU. operado en pesos es
 * su CEDEAR. Con pesos no se compra la acción de Nueva York, así que no hay
 * caso legítimo del otro lado. El CEDEAR se guarda como `SPY.BA`, que es como
 * lo nombran Yahoo y el resto del catálogo para lo que cotiza en BYMA: un
 * símbolo propio evita que choque con la acción si algún día se tienen las
 * dos.
 */

type Listing = Pick<Asset, "symbol" | "source" | "currency" | "kind">;

/** La acción o el ETF tal como cotiza en EE.UU., en dólares. */
export function isUsListing(asset: Listing): boolean {
  return (
    asset.source === "yahoo" &&
    asset.currency === "USD" &&
    (asset.kind === "stock" || asset.kind === "etf") &&
    // "GGAL.BA", "BRK-B" con sufijo de mercado ya no son la acción de EE.UU.
    !asset.symbol.includes(".")
  );
}

export function cedearSymbol(symbol: string): string {
  return `${symbol.trim().toUpperCase().replace(/\.BA$/, "")}.BA`;
}

/** El CEDEAR de una acción de EE.UU.: mismo papel, en pesos, en BYMA. */
export function cedearOf(base: Pick<Asset, "symbol" | "name">, id: string): Asset {
  const symbol = cedearSymbol(base.symbol);
  const name = base.name && base.name !== base.symbol ? base.name : base.symbol;
  return {
    id,
    symbol,
    name: `${name.replace(/\s*\(CEDEAR\)$/, "")} (CEDEAR)`,
    kind: "cedear",
    currency: "ARS",
    source: "byma",
    sourceSymbol: symbol,
    precision: 2,
  };
}

export interface TradeAsset {
  asset: Asset;
  /** Hay que guardarlo: no existía todavía. */
  nuevo: boolean;
  /** Se cambió la acción por su CEDEAR, y la pantalla lo tiene que decir. */
  cedear: boolean;
}

/**
 * El activo que corresponde a una operación, con la regla del CEDEAR aplicada.
 *
 * Es el único lugar que decide esto: la carga suelta, el recorrido guiado y la
 * importación de notas pasan todos por acá. Si cada uno lo resolviera por su
 * cuenta, alguno se olvidaría del caso de los pesos.
 */
export function resolveTradeAsset(
  assets: Asset[],
  symbol: string,
  currency: Currency,
  newId: () => string,
  options: { catalog?: CatalogEntry; existing?: Asset } = {},
): TradeAsset {
  const clean = symbol.trim().toUpperCase();
  const existing = options.existing ?? findAssetBySymbol(assets, clean);
  const plantilla: Listing & { name: string } | undefined =
    existing ?? options.catalog ?? lookupCatalog(clean) ?? undefined;

  if (currency === "ARS" && plantilla && isUsListing(plantilla)) {
    const ya = findAssetBySymbol(assets, cedearSymbol(plantilla.symbol));
    if (ya) return { asset: ya, nuevo: false, cedear: true };
    return { asset: cedearOf(plantilla, newId()), nuevo: true, cedear: true };
  }

  if (existing) return { asset: existing, nuevo: false, cedear: false };
  return {
    asset: assetFromSymbol(clean, newId(), { catalog: options.catalog, currency }),
    nuevo: true,
    cedear: false,
  };
}

/**
 * Acciones de EE.UU. que en realidad son CEDEARs cargados antes de que
 * existiera la regla: todas sus compras y ventas son en pesos.
 *
 * No hay falso positivo posible: con pesos no se opera la acción de Nueva
 * York. Por eso la app puede proponer el arreglo con un toque en vez de
 * limitarse a avisar.
 */
export function misloadedCedears(assets: Asset[], transactions: Transaction[]): Asset[] {
  return assets.filter((asset) => {
    if (!isUsListing(asset)) return false;
    const operaciones = transactions.filter(
      (t) => t.assetId === asset.id && (t.type === "buy" || t.type === "sell"),
    );
    return operaciones.length > 0 && operaciones.every((t) => t.currency === "ARS");
  });
}

/**
 * Convierte la acción mal cargada en su CEDEAR.
 *
 * Si el CEDEAR ya existe, los movimientos se pasan a él y la acción se borra;
 * si no, la acción se transforma en el lugar, conservando el id para que los
 * movimientos y las alertas sigan apuntando a lo mismo. En los dos casos se
 * tiran las cotizaciones guardadas: eran las de la acción en dólares, y dejarlas
 * valuaría el CEDEAR a veinte veces su precio hasta el próximo refresco.
 */
export async function convertToCedear(db: WaltraDB, asset: Asset, assets: Asset[]): Promise<Asset> {
  const destino = findAssetBySymbol(assets, cedearSymbol(asset.symbol));
  let resultado: Asset;
  await db.transaction("rw", [db.assets, db.transactions, db.priceSeries, db.quotes], async () => {
    if (destino && destino.id !== asset.id) {
      await db.transactions.where("assetId").equals(asset.id).modify({ assetId: destino.id });
      await db.assets.delete(asset.id);
      resultado = destino;
    } else {
      resultado = cedearOf(asset, asset.id);
      await db.assets.put(resultado);
    }
    await db.priceSeries.delete(asset.id);
    await db.quotes.delete(asset.id);
  });
  return resultado!;
}
