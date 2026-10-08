import type { WaltraDB } from "@/lib/db";

/**
 * Que hay de verdad en la base, para cuando la app aparece vacia.
 *
 * Una base que no abre y una base vacia se ven igual desde la pantalla: los
 * dos casos llegaban a «Cargá tu primer movimiento». Esto separa uno de otro y
 * dice cuantos registros hay en cada tabla, sin tocar nada.
 */
export interface StorageReport {
  origin: string;
  /** Las bases que el navegador conoce en este origen, con su version. */
  databases: { name: string; version?: number }[] | null;
  /** Cuantos registros tiene cada tabla, o el error al leerla. */
  tables: Record<string, number | string>;
  /** El error al abrir la base, si no abrio. */
  openError: string | null;
  usageBytes: number | null;
  quotaBytes: number | null;
  /** Si el navegador prometio no borrar los datos cuando falte lugar. */
  persisted: boolean | null;
}

function mensaje(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

export async function inspectStorage(db: WaltraDB | null): Promise<StorageReport> {
  const report: StorageReport = {
    origin: typeof location !== "undefined" ? location.origin : "",
    databases: null,
    tables: {},
    openError: null,
    usageBytes: null,
    quotaBytes: null,
    persisted: null,
  };
  try {
    const lista = await indexedDB.databases?.();
    if (lista) {
      report.databases = lista.map((d) => ({ name: d.name ?? "(sin nombre)", version: d.version }));
    }
  } catch {
    // No todos los motores lo tienen.
  }
  try {
    const est = await navigator.storage?.estimate?.();
    report.usageBytes = est?.usage ?? null;
    report.quotaBytes = est?.quota ?? null;
    report.persisted = (await navigator.storage?.persisted?.()) ?? null;
  } catch {
    // Igual que arriba.
  }
  if (!db) {
    report.openError = "La base no existe en este contexto.";
    return report;
  }
  try {
    await db.open();
  } catch (err) {
    report.openError = mensaje(err);
    return report;
  }
  for (const table of db.tables) {
    try {
      report.tables[table.name] = await table.count();
    } catch (err) {
      report.tables[table.name] = mensaje(err);
    }
  }
  return report;
}

/**
 * Pide que el navegador no borre la base cuando el telefono se queda sin
 * lugar. Sin esto, los datos de una app web son "de mejor esfuerzo": el
 * sistema puede limpiarlos. No hace nada si ya estaba concedido.
 */
export async function askPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
