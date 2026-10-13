import { z } from "zod";
import { DEFAULT_SETTINGS, defaultAccounts, type WaltraDB } from "@/lib/db";
import type { Settings } from "@/lib/types";

const currency = z.enum(["USD", "ARS"]);
const id = z.string().min(1).max(1000);
const number = z.number().finite();
const reportKind = z.enum(["cartera", "mercado", "conducta", "riesgo", "posicion", "decision"]);

/**
 * Los ajustes que son de este dispositivo y no viajan nunca: credenciales,
 * permisos que pidio este telefono y marcas de su propia sincronizacion. Lo
 * que no esta en el esquema de abajo tiene que estar aca, y al reves: el test
 * de paridad no compila si un campo nuevo de `Settings` no eligio lado.
 */
export const LOCAL_SETTINGS = ["lastQuoteSync", "accessKey", "apiKey", "geminiKey", "updateNotify", "notifAsked"] as const;

/**
 * El mismo esquema en dos versiones. Al subir se descarta lo que no esta en la
 * lista: credenciales, datos del dispositivo y campos viejos que ya nadie usa.
 * Al bajar se rechaza: un campo desconocido viene de una version mas nueva de
 * Waltra, y descartarlo y despues subir la copia se lo borraria al telefono
 * que si lo entiende. Un campo nuevo en un tipo sincronizado va aca; el test
 * de paridad (`__tests__/data.test.ts`) no compila hasta que este.
 */
function schemas(strict: boolean) {
  const object = <T extends z.core.$ZodLooseShape>(shape: T) =>
    (strict ? z.strictObject(shape) : z.object(shape)) as ReturnType<typeof z.object<T>>;

  const settings = object({
    id: z.literal("settings"), baseCurrency: currency,
    riskProfile: z.enum(["conservador", "moderado", "agresivo"]),
    horizonYears: number, goals: z.string(), benchmark: z.string().optional(),
    onboarded: z.boolean().optional(), provider: z.enum(["anthropic", "gemini"]).optional(),
    model: z.string().optional(), compareMethod: z.enum(["aportes", "mensual", "inicio"]).optional(),
    theme: z.enum(["color", "mono"]).optional(), haptics: z.boolean().optional(),
    alerts: object({
      enabled: z.boolean(), defaultPct: number, perAsset: z.record(z.string(), number),
      portfolioPct: number, digestHour: number.nullable(), quietFrom: number, quietTo: number,
    }).optional(),
    schedules: z.array(object({
      kind: reportKind, enabled: z.boolean(), weekday: number, hour: number,
      lastRun: z.string().optional(),
    })).optional(),
  });

  return object({
    app: z.literal("waltra"), version: z.literal(1),
    accounts: z.array(object({
      id, name: z.string(), broker: z.enum(["cocos", "binance", "other"]),
      currency, archived: z.boolean().optional(), createdAt: z.string(),
    })),
    assets: z.array(object({
      id, symbol: z.string(), name: z.string(),
      kind: z.enum(["stock", "cedear", "etf", "crypto", "fund", "bond", "cash"]),
      currency, source: z.enum(["binance", "yahoo", "byma", "manual"]),
      sourceSymbol: z.string(), precision: number, manualPrice: number.optional(),
      priceUnit: number.optional(), archived: z.boolean().optional(),
    })),
    transactions: z.array(object({
      id, date: z.string().min(1),
      type: z.enum(["deposit", "withdraw", "buy", "sell", "dividend", "interest", "fee", "transfer", "exchange", "split", "adjust"]),
      accountId: id, counterAccountId: id.optional(), assetId: id.optional(),
      quantity: number.optional(), price: number.optional(), amount: number, currency,
      fee: number.optional(), fxRate: number.optional(), ratio: number.optional(),
      toAmount: number.optional(), toCurrency: currency.optional(),
      note: z.string().optional(), raw: z.string().optional(),
      createdAt: z.string(), updatedAt: z.string(),
    })),
    settings,
    insights: z.array(object({
      id, createdAt: z.string(), model: z.string(), kind: reportKind.optional(),
      question: z.string().optional(), focus: z.string().optional(), marketBrief: z.string(),
      signals: z.array(object({
        symbol: z.string(), action: z.enum(["acumular", "mantener", "reducir", "vender", "vigilar"]),
        confidence: z.enum(["alta", "media", "baja"]), headline: z.string(), rationale: z.string(), horizon: z.string(),
      })),
      profileRead: object({
        summary: z.string(), observations: z.array(z.string()), risks: z.array(z.string()), suggestions: z.array(z.string()),
      }),
      sources: z.array(object({ title: z.string(), url: z.string() })),
      degraded: z.boolean().optional(), portfolioDigest: z.string(),
    })),
  });
}

const upload = schemas(false);
const download = schemas(true);

export type CloudData = z.infer<typeof upload>;
export const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

/** Un problema con el contenido de la copia, no con la red: reintentar no lo arregla. */
export class CloudFormatError extends Error {}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join(".") || "raíz"}: ${issue.message}` : error.message;
}

/** Orden estable, sin depender del orden de las claves o de las filas de IndexedDB. */
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .filter(([, v]) => v !== undefined).map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}

export function encodeData(input: unknown): string {
  const parsed = upload.safeParse(input);
  if (!parsed.success) {
    throw new CloudFormatError(`Hay datos en este dispositivo que no se pueden sincronizar (${firstIssue(parsed.error)}). No se subió nada.`);
  }
  const data = parsed.data;
  for (const rows of [data.accounts, data.assets, data.transactions, data.insights]) {
    if (new Set(rows.map((row) => row.id)).size !== rows.length) {
      throw new CloudFormatError("La copia contiene identificadores duplicados.");
    }
    rows.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
  const payload = JSON.stringify(canonical(data));
  checkSize(payload);
  return payload;
}

function checkSize(payload: string): void {
  if (new TextEncoder().encode(payload).length > MAX_PAYLOAD_BYTES) {
    throw new CloudFormatError("La cartera supera el límite de sincronización de 5 MiB. Exportá un backup.");
  }
}

export function decodeData(payload: string): CloudData {
  checkSize(payload);
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    throw new CloudFormatError("La copia de Drive está dañada: no es un archivo de Waltra. No se modificó nada.");
  }
  const parsed = download.safeParse(json);
  if (!parsed.success) {
    // Un campo o un valor que esta version no conoce es, casi siempre, otro
    // telefono con una version mas nueva de la app.
    const newer = parsed.error.issues.some((issue) => issue.code === "unrecognized_keys" || issue.code === "invalid_value");
    throw new CloudFormatError(newer
      ? "La copia de Drive tiene datos de una versión más nueva de Waltra. Actualizá la app en este equipo para sincronizar. No se modificó nada."
      : `La copia de Drive tiene datos que no son válidos (${firstIssue(parsed.error)}). No se modificó nada.`);
  }
  return parsed.data;
}

export async function readData(db: WaltraDB): Promise<string> {
  return db.transaction("r", [db.accounts, db.assets, db.transactions, db.settings, db.insights], async () => {
    const [accounts, assets, transactions, settings, insights] = await Promise.all([
      db.accounts.toArray(), db.assets.toArray(), db.transactions.toArray(),
      db.settings.get("settings"), db.insights.toArray(),
    ]);
    return encodeData({ app: "waltra", version: 1, accounts, assets, transactions,
      settings: { ...DEFAULT_SETTINGS, ...settings }, insights });
  });
}

/** Solo una instalacion sin cambios propios puede recibir la primera copia sin preguntar. */
export function isPristine(payload: string): boolean {
  const data = decodeData(payload);
  const accounts = (rows: CloudData["accounts"]) => rows.map((row) => ({ ...row, createdAt: "" }))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return data.assets.length === 0 && data.transactions.length === 0 && data.insights.length === 0 &&
    JSON.stringify(canonical(accounts(data.accounts))) === JSON.stringify(canonical(accounts(defaultAccounts()))) &&
    JSON.stringify(canonical(data.settings)) === JSON.stringify(canonical(upload.shape.settings.parse(DEFAULT_SETTINGS)));
}

/** Debe ejecutarse dentro de una transaccion junto con el estado de sincronizacion. */
export async function replaceData(db: WaltraDB, payload: string): Promise<void> {
  const data = decodeData(payload);
  const local = await db.settings.get("settings");
  await Promise.all([db.accounts.clear(), db.assets.clear(), db.transactions.clear(), db.insights.clear(),
    db.priceSeries.clear(), db.quotes.clear(), db.fx.clear()]);
  await db.accounts.bulkPut(data.accounts);
  await db.assets.bulkPut(data.assets);
  await db.transactions.bulkPut(data.transactions);
  await db.insights.bulkPut(data.insights);
  const settings: Settings = { ...DEFAULT_SETTINGS, ...data.settings };
  for (const key of LOCAL_SETTINGS) {
    if (local?.[key] !== undefined) Object.assign(settings, { [key]: local[key] });
  }
  await db.settings.put(settings);
}
