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
 * IndexedDB sigue siendo la fuente de la interfaz, incluso sin conexion.
 * La sincronizacion opcional guarda una copia privada en el Drive del usuario.
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
  cloudState!: Table<CloudState, string>;
  cloudBackups!: Table<CloudBackup, number>;

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
    this.version(2).stores({
      cloudState: "id",
      cloudBackups: "++id, at",
    });
  }
}

export interface CloudState {
  id: "cloud";
  /**
   * La cuenta de Google (`sub`): nunca se publica esta base en el Drive de otra.
   * No incluye el cliente OAuth, para que cambiarlo no deje a todas las
   * instalaciones trabadas; un Drive nuevo y vacio se pregunta igual.
   */
  owner: string;
  /** Solo para decirle al usuario con que cuenta quedo vinculada. */
  email?: string;
  /** Ultima copia confirmada por el servidor, para detectar cambios offline. */
  base: string | null;
  syncedAt?: string;
  /** El usuario toco Desconectar: el APK no vuelve a entrar solo al abrir. */
  paused?: boolean;
}

export interface CloudBackup {
  id?: number;
  at: string;
  payload: string;
  /** De donde salio lo que se iba a pisar: este dispositivo o la copia de Drive. */
  origin?: "device" | "drive";
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
  // Comparar contra el S&P 500 es la referencia por defecto: es lo que
  // contesta "¿me hubiera ido mejor sin elegir nada?".
  benchmark: "SPY",
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
  /** Opcional para seguir aceptando los backups anteriores. */
  insights?: InsightReport[];
}

export async function exportBackup(db: WaltraDB): Promise<BackupFile> {
  const [accounts, assets, transactions, settings, insights] = await Promise.all([
    db.accounts.toArray(),
    db.assets.toArray(),
    db.transactions.toArray(),
    db.settings.get("settings"),
    db.insights.toArray(),
  ]);
  return {
    app: "waltra",
    version: 1,
    exportedAt: new Date().toISOString(),
    accounts,
    assets,
    transactions,
    insights,
    // Ninguna credencial viaja en el backup: el archivo puede terminar en
    // cualquier lado (Drive, WhatsApp, un mail a uno mismo).
    settings: {
      ...(settings ?? DEFAULT_SETTINGS),
      accessKey: undefined,
      apiKey: undefined,
      geminiKey: undefined,
    },
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
  if (file.insights !== undefined && !Array.isArray(file.insights)) {
    throw new Error("Los informes del backup no tienen un formato válido.");
  }
  return file as BackupFile;
}

export async function importBackup(
  db: WaltraDB,
  file: BackupFile,
  mode: "replace" | "merge",
): Promise<ImportSummary> {
  await db.transaction("rw", db.accounts, db.assets, db.transactions, db.settings, db.insights, async () => {
    if (mode === "replace") {
      await Promise.all([db.accounts.clear(), db.assets.clear(), db.transactions.clear()]);
      if (file.insights) await db.insights.clear();
    }
    await db.accounts.bulkPut(file.accounts);
    await db.assets.bulkPut(file.assets ?? []);
    await db.transactions.bulkPut(file.transactions);
    if (file.insights) await db.insights.bulkPut(file.insights);
    if (file.settings) {
      const current = await db.settings.get("settings");
      await db.settings.put({
        ...DEFAULT_SETTINGS,
        ...file.settings,
        // Los datos locales del dispositivo no se pisan desde un backup.
        accessKey: current?.accessKey,
        apiKey: current?.apiKey,
        geminiKey: current?.geminiKey,
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
    [db.accounts, db.assets, db.transactions, db.priceSeries, db.quotes, db.fx, db.settings, db.insights, db.cloudBackups],
    async () => {
      await Promise.all([
        db.accounts.clear(),
        db.assets.clear(),
        db.transactions.clear(),
        db.priceSeries.clear(),
        db.quotes.clear(),
        db.fx.clear(),
        db.insights.clear(),
        db.cloudBackups.clear(),
        db.settings.clear(),
      ]);
    },
  );
}
