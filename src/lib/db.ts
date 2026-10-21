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
  connections!: Table<BinanceConnection, string>;

  /** El nombre solo cambia en los tests, para tener dos telefonos a la vez. */
  constructor(name = "waltra") {
    super(name);
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
    // Una tabla aparte y no un campo de los ajustes: asi la clave no entra
    // por descuido ni en el backup ni en la copia de Drive, que copian tablas
    // con nombre y no "todo lo que haya".
    this.version(3).stores({
      connections: "id",
    });
  }
}

/**
 * La conexion de solo lectura con Binance. Ver `src/lib/binance/sync.ts`.
 *
 * Vive solo en este telefono: la clave no viaja en el backup ni a Drive, y lo
 * demas (por donde va cada historial) es de este telefono y de esta clave.
 */
export interface BinanceConnection {
  id: "binance";
  /**
   * Vacias despues de Desconectar: la fila queda para recordar lo que el
   * usuario borro y hasta donde se leyo, por si vuelve a conectar.
   */
  apiKey: string;
  secret: string;
  /** El numero de cuenta de Binance. Una clave de otra cuenta empieza de cero. */
  uid?: number;
  /** La cuenta de Waltra donde caen los movimientos. */
  accountId: string;
  /** YYYY-MM-DD: lo anterior ya estaba cargado y no se trae. */
  since: string;
  createdAt: string;
  /** El primer mes de Earn que todavia no se cargo (los meses se cargan cerrados, una vez). */
  cursors: { earn?: number };
  /** Saldos de la billetera spot en la pasada anterior: si no cambiaron, no hubo operaciones. */
  balances?: Record<string, number>;
  /** Lo bloqueado en ordenes abiertas en la pasada anterior: si cambia, una orden termino. */
  locked?: Record<string, number>;
  /** Pares que falta mirar ("BTC/USDT"). Se guarda: una pasada cortada sigue donde quedo. */
  queue?: string[];
  /**
   * Historiales que una pasada corto antes de llegar a lo que ya estaba: desde
   * donde seguir para atras, en ms. Sin esto, la proxima pararia en lo recien
   * guardado y lo mas viejo no entraria nunca.
   */
  resume?: Record<string, number>;
  /** Cuando se miraron por ultima vez las compras con tarjeta y Earn. */
  slowAt?: number;
  /** El historial en pesos pesa mucho: una vez por dia. */
  fiatAt?: number;
  /** Cada registro de Binance que ya estaba cargado a mano, con el id de lo cargado. */
  matched?: Record<string, string>;
  /** Movimientos traidos que el usuario borro: no se vuelven a crear. */
  ignored?: string[];
  /** Binance pidio esperar (limite de pedidos): no se le pregunta antes de esto. */
  blockedUntil?: number;
  /** La clave dejo de servir: no se reintenta solo hasta que la cambien. */
  authError?: string;
  lastRun?: BinanceRunSummary;
}

export interface BinanceRunSummary {
  at: string;
  added: number;
  updated: number;
  /** Ya estaban cargados a mano: no se suman dos veces. */
  dupes: number;
  /** Lo que se leyo y no se pudo cargar, con el motivo. */
  skipped: string[];
  /** Quedo historial por traer: sigue en la proxima pasada. */
  partial: boolean;
  error?: string;
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
  /** La revision de Drive que corresponde a `base`: si no cambio, no se baja. */
  remote?: { id: string; etag: string; chain?: string[] };
  syncedAt?: string;
  /** El usuario toco Desconectar: el APK no vuelve a entrar solo al abrir. */
  paused?: boolean;
  /**
   * Una subida en vuelo: de que copia local salio y con que id. Si la respuesta
   * se pierde, la proxima pasada busca ese id en la cadena de la copia de
   * Drive para saber si la subida llego, aunque otro equipo haya subido encima.
   */
  sending?: { base: string; id: string };
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
    [db.accounts, db.assets, db.transactions, db.priceSeries, db.quotes, db.fx, db.settings, db.insights, db.cloudBackups, db.connections],
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
        // Borrar todo incluye la clave de Binance: si no, la proxima pasada
        // volveria a llenar la base que se acaba de vaciar.
        db.connections.clear(),
      ]);
    },
  );
}
