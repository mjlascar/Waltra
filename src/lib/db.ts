import Dexie, { type Table } from "dexie";
import type {
  Account,
  Asset,
  FxRate,
  InsightReport,
  PriceSeries,
  Quote,
  Settings,
  Transaction,
} from "@/lib/types";

/**
 * Todo vive en el telefono (IndexedDB). No hay servidor, no hay cuenta, no hay
 * nadie mirando tus numeros. El costo de esa decision es que hay que hacer
 * backup a mano: por eso Ajustes tiene exportar/importar y la app lo recuerda.
 */
export class WaltraDB extends Dexie {
  accounts!: Table<Account, string>;
  assets!: Table<Asset, string>;
  transactions!: Table<Transaction, string>;
  priceSeries!: Table<PriceSeries, string>;
  quotes!: Table<Quote, string>;
  fx!: Table<FxRate, string>;
  settings!: Table<Settings, string>;
  insights!: Table<InsightReport, string>;

  constructor() {
    super("waltra");
    this.version(1).stores({
      accounts: "id, broker, name",
      assets: "id, symbol, kind, source",
      transactions: "id, date, type, accountId, assetId",
      priceSeries: "assetId",
      quotes: "assetId",
      fx: "date",
      settings: "id",
      insights: "id, createdAt",
    });
  }
}

let instance: WaltraDB | null = null;

/** La base solo existe en el navegador; en el servidor devuelve null. */
export function getDb(): WaltraDB | null {
  if (typeof window === "undefined") return null;
  if (!instance) instance = new WaltraDB();
  return instance;
}

export const DEFAULT_SETTINGS: Settings = {
  id: "settings",
  baseCurrency: "USD",
  riskProfile: "moderado",
  horizonYears: 5,
  goals: "",
  onboarded: false,
};

export function defaultAccounts(): Account[] {
  const now = new Date().toISOString();
  return [
    { id: "cocos", name: "Cocos Capital", broker: "cocos", currency: "USD", createdAt: now },
    { id: "binance", name: "Binance", broker: "binance", currency: "USD", createdAt: now },
  ];
}

/** Crea las cuentas y los ajustes por defecto la primera vez que abris la app. */
export async function ensureSeeded(db: WaltraDB): Promise<void> {
  const settings = await db.settings.get("settings");
  if (!settings) await db.settings.put(DEFAULT_SETTINGS);
  const count = await db.accounts.count();
  if (count === 0) await db.accounts.bulkPut(defaultAccounts());
}

export interface BackupFile {
  app: "waltra";
  version: 1;
  exportedAt: string;
  accounts: Account[];
  assets: Asset[];
  transactions: Transaction[];
  settings: Settings;
}

export async function exportBackup(db: WaltraDB): Promise<BackupFile> {
  const [accounts, assets, transactions, settings] = await Promise.all([
    db.accounts.toArray(),
    db.assets.toArray(),
    db.transactions.toArray(),
    db.settings.get("settings"),
  ]);
  return {
    app: "waltra",
    version: 1,
    exportedAt: new Date().toISOString(),
    accounts,
    assets,
    transactions,
    // La clave de acceso no viaja en el backup: el archivo puede terminar en
    // cualquier lado.
    settings: { ...(settings ?? DEFAULT_SETTINGS), accessKey: undefined },
  };
}

export interface ImportSummary {
  accounts: number;
  assets: number;
  transactions: number;
}

/** Valida la forma del archivo antes de tocar nada de lo que ya hay. */
export function parseBackup(text: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("El archivo no es un JSON valido.");
  }
  const file = data as Partial<BackupFile>;
  if (file?.app !== "waltra") throw new Error("Ese archivo no es un backup de Waltra.");
  if (!Array.isArray(file.transactions) || !Array.isArray(file.accounts)) {
    throw new Error("El backup esta incompleto.");
  }
  return file as BackupFile;
}

export async function importBackup(
  db: WaltraDB,
  file: BackupFile,
  mode: "replace" | "merge",
): Promise<ImportSummary> {
  await db.transaction("rw", db.accounts, db.assets, db.transactions, db.settings, async () => {
    if (mode === "replace") {
      await Promise.all([db.accounts.clear(), db.assets.clear(), db.transactions.clear()]);
    }
    await db.accounts.bulkPut(file.accounts);
    await db.assets.bulkPut(file.assets ?? []);
    await db.transactions.bulkPut(file.transactions);
    if (file.settings) {
      const current = await db.settings.get("settings");
      await db.settings.put({
        ...DEFAULT_SETTINGS,
        ...file.settings,
        // Los datos locales del dispositivo no se pisan desde un backup.
        accessKey: current?.accessKey,
        id: "settings",
      });
    }
  });
  return {
    accounts: file.accounts.length,
    assets: file.assets?.length ?? 0,
    transactions: file.transactions.length,
  };
}

/** Borra todo. Solo se llama desde Ajustes y con confirmacion escrita. */
export async function wipeAll(db: WaltraDB): Promise<void> {
  await db.transaction(
    "rw",
    [db.accounts, db.assets, db.transactions, db.priceSeries, db.quotes, db.fx, db.settings, db.insights],
    async () => {
      await Promise.all([
        db.accounts.clear(),
        db.assets.clear(),
        db.transactions.clear(),
        db.priceSeries.clear(),
        db.quotes.clear(),
        db.fx.clear(),
        db.insights.clear(),
        db.settings.clear(),
      ]);
    },
  );
}
