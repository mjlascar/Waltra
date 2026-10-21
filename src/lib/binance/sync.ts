import type { BinanceConnection, BinanceRunSummary, WaltraDB } from "@/lib/db";
import type { Asset, Transaction } from "@/lib/types";
import { FxTable } from "@/lib/engine/fx";
import { binanceAsset, CAPITAL_IMPORTADO } from "@/lib/parse/binance";
import { daysBetween, today, toDay } from "@/lib/date";
import { BinanceError, type BinanceClient, type BinanceTransport, type Usage } from "./client";
import * as api from "./api";
import * as map from "./map";

/**
 * Traer de Binance lo nuevo, solo.
 *
 * Corre al abrir la app, al volver a ella y al tirar la pantalla para abajo
 * (ver `store.tsx`). Cada historial recuerda hasta donde se leyo, asi que una
 * pasada normal pregunta por los ultimos dias y nada mas.
 *
 * Las operaciones spot se piden par por par (Binance no tiene "todos los
 * pares"), y ahi esta el costo grande. Los pares a leer van a una cola que se
 * guarda: los del activo cuyo saldo spot cambio desde la pasada anterior,
 * todos los conocidos una vez por dia, y la primera vez todos los que cotizan
 * contra dolares o pesos, porque una cripto que se compro y se vendio entera
 * no deja otro rastro. Si la pasada se corta, la proxima sigue donde quedo.
 *
 * Binance limita lo que se le puede pedir por minuto y banea la IP que
 * insiste. La pasada lleva la cuenta con lo que dicen sus cabeceras y, si se
 * acerca al limite, guarda lo que tiene y sigue en la proxima.
 */

/** Entre una pasada y la siguiente, como minimo. Tirar la pantalla seguido solo actualiza precios. */
export const MIN_INTERVAL = 45_000;
/** "Traer ahora" no espera el minimo, pero tampoco pregunta dos veces seguidas. */
const MIN_FORCED = 10_000;
/** Lo ya leido se vuelve a mirar esta cantidad de dias: un ingreso o un retiro pueden tardar en acreditarse. */
const OVERLAP = 7 * api.DAY;
/** Earn y las compras con tarjeta cambian a lo sumo una vez por dia. */
const SLOW_EVERY = 6 * 3_600_000;
const DAILY = 24 * 3_600_000;
/** Contra que se cotiza lo que haya en la cuenta. */
const QUOTES = ["USDT", "FDUSD", "USDC", "TUSD", "BUSD", "DAI", "ARS", "BTC", "ETH", "BNB"];
/** Las cotizaciones en efectivo: la primera revision lee todos sus pares. Del sufijo mas largo al mas corto. */
const CASH_QUOTES = ["FDUSD", "USDT", "USDC", "TUSD", "DAI", "ARS"];
/** Lo que una pasada se permite gastar del limite por minuto, con margen. */
const BUDGET: Usage = { ip: 4000, sapiIp: 9000, uid: 120_000 };
/** Los activos que se recuerdan, para no crecer sin techo. */
const MAX_KNOWN = 600;

/** La pasada se queda sin cupo: se guarda lo que hay y sigue en la proxima. */
class OutOfBudget extends Error {}

export interface RunResult extends BinanceRunSummary {
  newAssets: number;
}

/** El dia en el reloj del telefono. */
const localDay = (ms: number) => today(new Date(ms));
const localMidnight = (day: string) => new Date(`${day}T00:00:00`).getTime();

function monthBounds(ms: number): [number, number] {
  const d = new Date(ms);
  return [
    new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
    new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() - 1,
  ];
}
const monthKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const close = (a: number, b: number, rel: number) => Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b));

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Un error que tiene que cortar la pasada: insistir no sirve o empeora. */
const corta = (err: unknown) => err instanceof BinanceError && (err.kind === "rate" || err.kind === "network");

/** "BTCUSDT" -> BTC contra USDT, si cotiza contra efectivo. */
function cashPair(symbol: string): { base: string; quote: string } | null {
  for (const quote of CASH_QUOTES) {
    if (symbol.length > quote.length && symbol.endsWith(quote)) return { base: symbol.slice(0, -quote.length), quote };
  }
  return null;
}

/** La lista de pares cambia muy de vez en cuando: se guarda unas horas por transporte. */
const symbolCache = new WeakMap<BinanceTransport, { at: number; set: Set<string> }>();

async function symbolsOf(client: BinanceClient, at: number): Promise<Set<string>> {
  const hit = symbolCache.get(client.transport);
  if (hit && at - hit.at < SLOW_EVERY && at >= hit.at) return hit.set;
  const set = await api.symbols(client);
  symbolCache.set(client.transport, { at, set });
  return set;
}

let running: Promise<RunResult | null> | null = null;

/**
 * Una pasada. Si ya hay una en curso, devuelve esa: abrir Ajustes mientras
 * la app sincroniza no tiene que duplicar pedidos.
 */
export function runBinance(
  db: WaltraDB,
  client: BinanceClient,
  options: { now?: () => number; force?: boolean } = {},
): Promise<RunResult | null> {
  if (!running) {
    running = pass(db, client, options).finally(() => {
      running = null;
    });
  }
  return running;
}

async function pass(
  db: WaltraDB,
  client: BinanceClient,
  options: { now?: () => number; force?: boolean },
): Promise<RunResult | null> {
  const now = options.now ?? Date.now;
  const conn = await db.connections.get("binance");
  if (!conn?.apiKey) return null;
  const t0 = now();
  // Ni con "Traer ahora": seguir preguntando despues de que Binance pidio
  // esperar es justamente lo que hace que banee la IP.
  if (conn.blockedUntil && conn.blockedUntil > t0) return null;
  // Un reloj que volvio para atras no deja la conexion frenada.
  const desde = conn.lastRun ? t0 - Date.parse(conn.lastRun.at) : Infinity;
  const reciente = (min: number) => desde >= 0 && desde < min;
  if (options.force ? reciente(MIN_FORCED) : conn.authError || reciente(MIN_INTERVAL)) return null;
  const due = (at: number | undefined, every: number) => !at || t0 - at >= every || t0 < at;

  const since = localMidnight(conn.since);
  const cursors: BinanceConnection["cursors"] = { ...conn.cursors, trades: { ...conn.cursors.trades } };
  let queue = [...(conn.queue ?? [])];
  const known = new Set(conn.known ?? []);
  let balances = conn.balances;
  let uid = conn.uid;
  let { fullScanAt, slowAt, fiatAt, snapshotAt } = conn;
  const groups: map.Group[] = [];
  const skipped: string[] = [];
  let partial = false;
  let progress = false;
  let fatal: BinanceError | null = null;

  const existingIds = new Set((await db.transactions.toCollection().primaryKeys()) as string[]);
  const roomFor = (cost: Partial<Usage>) =>
    client.usage.ip + (cost.ip ?? 0) <= BUDGET.ip &&
    client.usage.sapiIp + (cost.sapiIp ?? 0) <= BUDGET.sapiIp &&
    client.usage.uid + (cost.uid ?? 0) <= BUDGET.uid;

  const cache = new Map<string, Promise<number | null>>();
  const usd: map.UsdPrice = (asset, at) => {
    const side = map.sideOf(asset);
    if (side.kind === "cash" && side.currency === "USD") return Promise.resolve(1);
    const key = `${asset}|${Math.floor(at / 3_600_000)}`;
    let hit = cache.get(key);
    if (!hit) {
      if (!roomFor({ ip: 6 })) throw new OutOfBudget();
      hit = (async () => {
        for (const q of ["USDT", "FDUSD", "USDC"]) {
          const p = await api.hourPrice(client, `${asset}${q}`, at);
          if (p) return p;
        }
        return null;
      })();
      cache.set(key, hit);
    }
    return hit;
  };

  const take = (m: map.Mapped) => {
    if (!m) return;
    if ("skip" in m) skipped.push(m.skip);
    else groups.push(m);
  };

  /**
   * Un historial por ventanas de tiempo. El cursor avanza ventana por
   * ventana, despues de leer y traducir todo lo de esa ventana: si la pasada
   * se corta, la proxima arranca donde quedo. Devuelve si llego hasta hoy.
   */
  async function stream<T>(
    name: string,
    key: Exclude<keyof BinanceConnection["cursors"], "trades" | "earn">,
    win: number,
    cost: Partial<Usage>,
    fetch: (s: number, e: number) => Promise<T[]>,
    handle: (x: T) => Promise<map.Mapped> | map.Mapped,
    floor = 0,
  ): Promise<boolean> {
    const from = Math.max(since, (cursors[key] ?? since) - OVERLAP, floor);
    for (const [s, e] of api.windows(from, t0, win)) {
      if (!roomFor(cost)) {
        partial = true;
        return false;
      }
      let items: T[];
      try {
        items = await fetch(s, e);
      } catch (err) {
        if (corta(err)) throw err;
        // Un historial que esta clave o esta cuenta no puede leer (por pais,
        // por permisos) no frena a los demas.
        skipped.push(`No pude leer ${name}: ${messageOf(err)}`);
        return false;
      }
      const ventana: map.Mapped[] = [];
      for (const x of items) ventana.push(await handle(x));
      ventana.forEach(take);
      cursors[key] = e + 1;
      progress = true;
    }
    return true;
  }

  /** Earn, mes por mes: el mes en curso se rearma entero en cada pasada. */
  async function earn(): Promise<boolean> {
    let from = Math.max(since, cursors.earn ?? since);
    while (from <= t0) {
      const [ms, me] = monthBounds(from);
      const records: api.Reward[] = [];
      for (const [s, e] of api.windows(Math.max(ms, since), Math.min(me, t0), api.WINDOW.rewards)) {
        if (!roomFor({ sapiIp: 450 })) {
          partial = true;
          return false;
        }
        try {
          records.push(...(await api.rewards(client, s, e)));
        } catch (err) {
          if (corta(err)) throw err;
          skipped.push(`No pude leer Earn: ${messageOf(err)}`);
          return false;
        }
      }
      // Earn paga todos los dias: un precio por activo y por dia alcanza.
      const totals = new Map<string, { units: number; value: number; last: number }>();
      const porDia = new Map<string, { asset: string; units: number; at: number }>();
      for (const r of records) {
        const t = totals.get(r.asset) ?? { units: 0, value: 0, last: 0 };
        t.units += r.amount;
        t.last = Math.max(t.last, r.time);
        totals.set(r.asset, t);
        const k = `${r.asset}|${localDay(r.time)}`;
        const d = porDia.get(k) ?? { asset: r.asset, units: 0, at: r.time };
        d.units += r.amount;
        porDia.set(k, d);
      }
      for (const d of porDia.values()) {
        if (map.sideOf(d.asset).kind !== "crypto") continue;
        totals.get(d.asset)!.value += d.units * ((await usd(d.asset, d.at)) ?? 0);
      }
      for (const [asset, total] of totals) take(map.earnGroup(asset, monthKey(ms), total));
      // Un mes cerrado hace unos dias ya no cambia: no se vuelve a pedir.
      if (me + 3 * api.DAY < t0) cursors.earn = me + 1;
      progress = true;
      from = me + 1;
    }
    return true;
  }

  /** Las ejecuciones de un par desde donde se habia llegado, ya traducidas. */
  async function scanPair(key: string): Promise<"done" | "cut"> {
    const [base, quote] = key.split("/");
    const symbol = `${base}${quote}`;
    let fromId = (cursors.trades[key] ?? -1) + 1;
    const fs: api.Fill[] = [];
    let cut = false;
    for (;;) {
      if (!roomFor({ ip: 20 })) {
        cut = true;
        break;
      }
      let page: api.Fill[];
      try {
        page = await api.tradesPage(client, symbol, fromId);
      } catch (err) {
        if (corta(err)) throw err;
        skipped.push(`No pude leer las operaciones de ${key}: ${messageOf(err)}`);
        return "done";
      }
      fs.push(...page);
      if (page.length) fromId = Math.max(...page.map((f) => f.id)) + 1;
      if (page.length < api.TRADES_PAGE) break;
    }
    const ordenes: map.Mapped[] = [];
    for (const o of map.ordersFromFills(base, quote, fs.filter((f) => f.time >= since))) {
      let orden = o;
      // Una orden que ya estaba guardada se siguio ejecutando: se rearma con
      // todas sus ejecuciones, no solo con las nuevas.
      if (existingIds.has(map.orderId(o))) {
        if (!roomFor({ ip: 5 })) throw new OutOfBudget();
        orden = map.ordersFromFills(base, quote, await api.orderFills(client, symbol, o.orderId))[0] ?? o;
      }
      ordenes.push(await map.orderGroup(orden, usd));
    }
    ordenes.forEach(take);
    if (fs.length) cursors.trades[key] = Math.max(...fs.map((f) => f.id));
    else if (!(key in cursors.trades)) cursors.trades[key] = -1;
    if (fs.length) progress = true;
    return cut ? "cut" : "done";
  }

  /** Los pares que existen de un activo, contra lo que se cotiza en la cuenta. */
  const paresDe = (existentes: Set<string>, base: string) =>
    QUOTES.filter((q) => q !== base && existentes.has(`${base}${q}`)).map((q) => `${base}/${q}`);

  /** Arma la revision completa, si toca, y lee la cola mientras haya cupo. */
  async function trades(primera: boolean) {
    const completa = Boolean(options.force) || primera || due(fullScanAt, DAILY);
    if (completa) {
      const existentes = await symbolsOf(client, t0);
      const pares = (base: string) => paresDe(existentes, base);
      const resto: string[] = [];
      const [accountTxs, assets] = await Promise.all([
        db.transactions.where("accountId").equals(conn!.accountId).toArray(),
        db.assets.toArray(),
      ]);
      const porId = new Map(assets.map((a) => [a.id, a]));
      for (const t of accountTxs) {
        const a = t.assetId ? porId.get(t.assetId) : undefined;
        if (a?.kind === "crypto") known.add(a.symbol.toUpperCase());
      }
      for (const b of known) resto.push(...pares(b));
      if (primera) {
        // La primera vez, todos los pares contra dolares y pesos: una cripto
        // que se compro y se vendio entera antes de conectar no deja ningun
        // otro rastro.
        for (const symbol of existentes) {
          const par = cashPair(symbol);
          if (par) resto.push(`${par.base}/${par.quote}`);
        }
      }
      fullScanAt = t0;
      queue = [...new Set([...queue, ...resto])];
    }
    while (queue.length > 0) {
      if ((await scanPair(queue[0])) === "cut") {
        partial = true;
        return;
      }
      queue.shift();
      progress = true;
    }
  }

  try {
    const cuenta = await api.spotAccount(client);
    if (uid && cuenta.uid && uid !== cuenta.uid) {
      throw new BinanceError("Esta clave es de otra cuenta de Binance: conectala de nuevo para empezar con esa cuenta.", "auth");
    }
    uid = cuenta.uid ?? uid;
    const antes = balances;
    balances = cuenta.balances;
    const cambiaron = new Set<string>();
    if (antes) {
      for (const a of new Set([...Object.keys(antes), ...Object.keys(balances)])) {
        if (!close(antes[a] ?? 0, balances[a] ?? 0, 1e-9)) cambiaron.add(a);
      }
    }
    for (const a of Object.keys(balances)) known.add(a);
    // Los pares de lo que cambio entran a la cola ya, adelante de todo: si la
    // pasada se corta antes de llegar a las operaciones, la cola guardada se
    // acuerda aunque los saldos nuevos ya no muestren el cambio.
    if (cambiaron.size > 0) {
      const existentes = await symbolsOf(client, t0);
      queue = [...new Set([...[...cambiaron].flatMap((a) => paresDe(existentes, a)), ...queue])];
    }

    // Lo que pesa mucho va primero, mientras el cupo del minuto esta entero:
    // el historial en pesos gasta 90.000 de los 180.000 por cuenta.
    if (due(fiatAt, DAILY)) {
      const antesDeFiat = skipped.length;
      const listo = await stream("los ingresos en pesos", "fiat", api.WINDOW.fiat, { uid: 90_000 },
        (s, e) => api.fiatOrders(client, s, e), (o) => (o.time >= since ? map.fiatGroup(o) : null));
      // Si la cuenta no tiene ese historial, tampoco se insiste hasta mañana.
      if (listo || skipped.length > antesDeFiat) fiatAt = t0;
    }
    if (due(snapshotAt, DAILY) && roomFor({ sapiIp: 2400 })) {
      try {
        // La API da solo el ultimo mes, en ventanas de menos de 30 dias.
        for (const a of await api.snapshotAssets(client, Math.max(since, t0 - 29 * api.DAY), t0)) known.add(a);
      } catch (err) {
        if (corta(err)) throw err;
        skipped.push(`No pude leer los saldos de cada día: ${messageOf(err)}`);
      }
      snapshotAt = t0;
    }

    await stream("los ingresos", "deposits", api.WINDOW.deposits, { sapiIp: 1 }, (s, e) => api.deposits(client, s, e),
      (d) => (d.time >= since ? map.depositGroup(d, usd) : null));
    await stream("los retiros", "withdrawals", api.WINDOW.withdrawals, { uid: 18_000 }, (s, e) => api.withdrawals(client, s, e),
      (w) => (w.time >= since ? map.withdrawalGroup(w, usd) : null));
    await stream("Convert", "converts", api.WINDOW.converts, { uid: 3_000 }, (s, e) => api.converts(client, s, e),
      (c) => (c.time >= since ? map.convertGroup(c, usd) : null));
    await stream("P2P", "p2p", api.WINDOW.p2p, { sapiIp: 2 }, (s, e) => api.p2pOrders(client, s, e),
      (o) => (o.time >= since ? map.p2pGroup(o, usd) : null), t0 - api.P2P_HISTORY + api.DAY);
    if (since < t0 - api.P2P_HISTORY) {
      skipped.push(`Binance da solo seis meses de P2P: lo de antes del ${localDay(t0 - api.P2P_HISTORY)} hay que cargarlo a mano.`);
    }

    if (options.force || due(slowAt, SLOW_EVERY)) {
      const pagos = await stream("las compras con tarjeta", "payments", api.WINDOW.fiat, { sapiIp: 1 },
        (s, e) => api.fiatPayments(client, s, e), (p) => (p.time >= since ? map.paymentGroup(p, usd) : null));
      const ganancias = await earn();
      if (pagos && ganancias) slowAt = t0;
    }

    // Lo que aparecio en otros historiales tambien tiene pares que revisar.
    for (const g of groups) for (const d of g.drafts) if (d.symbol) known.add(d.symbol);
    await trades(antes === undefined);
  } catch (err) {
    if (err instanceof OutOfBudget) partial = true;
    else if (err instanceof BinanceError) fatal = err;
    else fatal = new BinanceError(messageOf(err), "api");
  }

  // Si la clave dejo de servir o Binance pidio esperar, igual se guarda lo
  // que se llego a leer: los cursores solo avanzaron por lo que esta en
  // `groups`, y la cola tiene lo que falta.
  const lastRunAt = new Date(t0).toISOString();
  const patch: Partial<BinanceConnection> = {
    cursors,
    balances,
    queue,
    known: [...known].slice(-MAX_KNOWN),
    uid,
    fullScanAt,
    slowAt,
    fiatAt,
    snapshotAt,
    authError: fatal?.kind === "auth" ? describeError(fatal) : undefined,
    blockedUntil: fatal?.kind === "rate" ? t0 + (fatal.retryAfter ?? 60) * 1000 : undefined,
  };
  return write(db, groups, patch, (w) => ({
    at: lastRunAt,
    added: w.added,
    updated: w.updated,
    dupes: w.dupes,
    skipped: [...new Set(skipped)].slice(0, 20),
    // Cortada sin haber avanzado no es "falta historial": es que no hubo
    // cupo, y no tiene sentido agendar otra igual en un minuto.
    partial: partial && progress && !fatal,
    ...(fatal ? { error: describeError(fatal) } : {}),
  }));
}

/** El error, en palabras para la pantalla. */
export function describeError(err: BinanceError): string {
  if (err.kind === "auth" && err.message.startsWith("Esta clave es de otra cuenta")) return err.message;
  if (err.kind === "auth") return "Binance no acepta la clave. Puede que la hayan borrado o vencido: cargá una nueva.";
  if (err.kind === "rate") return "Binance pidió esperar un rato antes de seguir preguntando.";
  if (err.kind === "network") return "No hubo respuesta de Binance. Se vuelve a intentar sola.";
  return err.message;
}

// ---------------------------------------------------------------------------
// Guardar

interface Written {
  added: number;
  updated: number;
  dupes: number;
  newAssets: number;
}

const CAMPOS = [
  "date", "type", "accountId", "assetId", "quantity", "price", "amount",
  "currency", "fee", "fxRate", "toAmount", "toCurrency", "note",
] as const;

function same(a: Transaction, b: Transaction): boolean {
  return CAMPOS.every((k) => {
    const x = a[k];
    const y = b[k];
    if (typeof x === "number" && typeof y === "number") return close(x, y, 1e-9);
    return x === y;
  });
}

function toTx(d: map.Draft, accountId: string, assetId: string | undefined, nowIso: string): Transaction {
  const tx: Transaction = {
    id: d.id,
    date: localDay(d.at),
    type: d.type,
    accountId,
    assetId,
    quantity: d.quantity,
    price: d.price,
    amount: d.amount,
    currency: d.currency,
    fee: d.fee,
    fxRate: d.fxRate,
    toAmount: d.toAmount,
    toCurrency: d.toCurrency,
    note: d.note,
    // La hora de Binance ordena los movimientos del mismo dia como pasaron.
    createdAt: new Date(d.at).toISOString(),
    updatedAt: nowIso,
  };
  for (const k of Object.keys(tx) as (keyof Transaction)[]) if (tx[k] === undefined) delete tx[k];
  return tx;
}

/**
 * El movimiento de un grupo que se compara con lo cargado a mano: la compra
 * o la venta si hay (una cripto que llega es "compré ETH"), si no el ingreso
 * o el retiro. Un interes, un ajuste o un cambio de moneda sueltos no se
 * comparan: lo cargado a mano de esas clases no tiene con que parecerse.
 */
function anchorOf(g: map.Group): map.Draft | undefined {
  return (
    g.drafts.find((d) => d.type === "buy" || d.type === "sell") ??
    g.drafts.find((d) => d.type === "deposit" || d.type === "withdraw")
  );
}

/**
 * Guarda lo traido y el estado de la conexion en una sola transaccion: los
 * cursores no avanzan sin que lo leido quede guardado. La conexion se relee
 * adentro: un borrado hecho mientras corria la pasada no se pisa.
 */
async function write(
  db: WaltraDB,
  groups: map.Group[],
  patch: Partial<BinanceConnection>,
  summary: (w: Written) => BinanceRunSummary,
): Promise<RunResult | null> {
  const fx = new FxTable(await db.fx.toArray(), 0);
  const nowIso = new Date().toISOString();
  const out: Written = { added: 0, updated: 0, dupes: 0, newAssets: 0 };
  let result: RunResult | null = null;

  await db.transaction("rw", [db.transactions, db.assets, db.connections], async () => {
    const conn = await db.connections.get("binance");
    // Desconectada o borrada mientras corria: no se escribe nada.
    if (!conn?.apiKey) return;
    const ignored = new Set(conn.ignored ?? []);
    const matched: Record<string, string> = { ...(conn.matched ?? {}) };
    const usados = new Set(Object.values(matched));
    const txs = await db.transactions.toArray();
    const byId = new Map(txs.map((t) => [t.id, t]));
    const assets = await db.assets.toArray();
    const nuevos: Asset[] = [];
    const puts: Transaction[] = [];

    /** El activo de un simbolo de Binance: la cripto ya cargada, o una nueva. */
    const assetFor = (symbol: string, crear: boolean): string | undefined => {
      const s = symbol.toUpperCase();
      const cripto = (a: Asset) => a.symbol.toUpperCase() === s && (a.kind === "crypto" || a.source === "binance");
      const found = assets.find((a) => cripto(a) && !a.archived) ?? assets.find(cripto);
      if (found || !crear) return found?.id;
      const asset = binanceAsset(s, newId());
      assets.push(asset);
      nuevos.push(asset);
      return asset.id;
    };

    const usdOf = (amount: number, currency: string, day: string, fxRate?: number) =>
      currency === "USD" ? amount : amount / (fxRate || fx.at(day) || NaN);

    /**
     * Lo mismo cargado a mano, lo mas parecido que haya: misma cuenta, mismo
     * tipo, dias cercanos, y las mismas unidades del mismo activo (una compra,
     * una cripto que llego) o el mismo monto (un ingreso, un retiro). Cada
     * cosa cargada a mano cubre a un solo registro de Binance.
     */
    const twin = (g: map.Group, a: map.Draft): Transaction | undefined => {
      const day = localDay(a.at);
      const trade = a.type === "buy" || a.type === "sell";
      const assetId = a.symbol ? assetFor(a.symbol, false) : undefined;
      if (trade && !assetId) return undefined;
      // Una orden del libro tiene fecha cierta; lo que viene de otra billetera puede tardar.
      const tol = /^binance-\d+$/.test(a.id) ? 1 : 3;
      const rate = g.drafts.find((d) => d.fxRate)?.fxRate;
      const valor = usdOf(a.amount, a.currency, day, a.fxRate ?? rate);
      let best: { t: Transaction; score: number } | undefined;
      for (const t of txs) {
        if (t.id.startsWith("binance-") || usados.has(t.id) || t.accountId !== conn.accountId || t.type !== a.type) continue;
        const dias = Math.abs(daysBetween(toDay(t.date), day));
        if (dias > tol) continue;
        let diff: number;
        if (trade) {
          if (t.assetId !== assetId || !close(t.quantity ?? 0, a.quantity ?? 0, 0.02)) continue;
          diff = Math.abs((t.quantity ?? 0) - (a.quantity ?? 0)) / Math.max(a.quantity ?? 1, 1e-12);
        } else {
          const suyo = usdOf(t.amount, t.currency, toDay(t.date), t.fxRate);
          if (!close(suyo, valor, 0.03)) continue;
          diff = Math.abs(suyo - valor) / Math.max(valor, 1e-12);
        }
        const score = diff * 100 + dias;
        if (!best || score < best.score) best = { t, score };
      }
      return best?.t;
    };

    // En orden de fecha: lo cargado a mano se empareja con lo que paso primero,
    // sea cual sea el historial de donde vino.
    const ordenados = [...groups].sort(
      (a, b) => Math.min(...a.drafts.map((d) => d.at)) - Math.min(...b.drafts.map((d) => d.at)),
    );
    for (const g of ordenados) {
      if (g.drafts.some((d) => ignored.has(d.id))) continue;
      const guardados = g.drafts.filter((d) => byId.has(d.id));
      if (guardados.length > 0 && !g.upsert) continue;
      if (guardados.length === 0) {
        const a = anchorOf(g);
        if (a) {
          const previo = matched[a.id];
          if (previo && byId.has(previo)) continue;
          const gemelo = twin(g, a);
          if (gemelo) {
            matched[a.id] = gemelo.id;
            usados.add(gemelo.id);
            out.dupes += 1;
            continue;
          }
        }
      }
      for (const d of g.drafts) {
        const tx = toTx(d, conn.accountId, d.symbol ? assetFor(d.symbol, true) : undefined, nowIso);
        const prev = byId.get(d.id);
        if (prev) {
          if (same(prev, tx)) continue;
          puts.push({ ...tx, createdAt: prev.createdAt });
          out.updated += 1;
        } else {
          puts.push(tx);
          out.added += 1;
        }
        byId.set(tx.id, tx);
      }
    }

    if (nuevos.length) await db.assets.bulkPut(nuevos);
    if (puts.length) await db.transactions.bulkPut(puts);
    out.newAssets = nuevos.length;
    const lastRun = summary(out);
    await db.connections.update("binance", { ...patch, matched, lastRun });
    result = { ...lastRun, newAssets: out.newAssets };
  });
  return result;
}

// ---------------------------------------------------------------------------
// Conectar y desconectar

export interface ConnectInput {
  apiKey: string;
  secret: string;
  accountId: string;
  since: string;
  /** Borrar el ingreso estimado de la importacion del archivo: los reales lo reemplazan. */
  dropEstimate?: boolean;
}

/**
 * Guarda la clave, despues de comprobar que sirve y que es de solo lectura.
 * Una clave que puede operar o retirar se rechaza: Waltra no la necesita, y
 * guardarla en el telefono seria un riesgo sin ninguna ganancia.
 */
export async function connectBinance(db: WaltraDB, client: BinanceClient, input: ConnectInput): Promise<string | null> {
  let cuenta: api.SpotAccount;
  try {
    const check = await api.checkKey(client);
    if (!check.canRead) return "La clave no tiene permiso de lectura. Activá «Habilitar lectura» en Binance.";
    if (check.risky.length) {
      return `Esta clave también puede ${check.risky.join(", ")}. Creá una con solo «Habilitar lectura»: Waltra no necesita más.`;
    }
    cuenta = await api.spotAccount(client);
  } catch (err) {
    if (err instanceof BinanceError && err.kind === "auth") {
      return "Binance no reconoce esa clave. Revisá que hayas copiado las dos completas.";
    }
    return err instanceof BinanceError ? describeError(err) : messageOf(err);
  }

  const previa = await db.connections.get("binance");
  // La misma cuenta de Binance: la de antes si Binance da el numero, o la misma clave.
  const misma = Boolean(
    previa && (previa.uid !== undefined && cuenta.uid !== undefined ? previa.uid === cuenta.uid : previa.apiKey === input.apiKey),
  );
  // Traer desde mas tarde no necesita releer nada; desde antes, si.
  const sigue = misma && previa !== undefined && input.since >= previa.since;
  const nowIso = new Date().toISOString();

  await db.transaction("rw", [db.connections, db.transactions], async () => {
    if (misma && previa && previa.accountId !== input.accountId) {
      // Todo lo de Binance se muda junto: si no, la historia queda partida
      // entre dos cuentas y ninguna de las dos cierra.
      const mudar = (await db.transactions.where("accountId").equals(previa.accountId).toArray()).filter((t) =>
        t.id.startsWith("binance-"),
      );
      await db.transactions.bulkPut(mudar.map((t) => ({ ...t, accountId: input.accountId, updatedAt: nowIso })));
    }
    if (input.dropEstimate) await db.transactions.delete(CAPITAL_IMPORTADO);
    await db.connections.put({
      id: "binance",
      apiKey: input.apiKey,
      secret: input.secret,
      uid: cuenta.uid,
      accountId: input.accountId,
      since: input.since,
      createdAt: nowIso,
      cursors: sigue && previa ? previa.cursors : { trades: {} },
      ...(sigue && previa
        ? {
            balances: previa.balances,
            queue: previa.queue,
            known: previa.known,
            fullScanAt: previa.fullScanAt,
            slowAt: previa.slowAt,
            fiatAt: previa.fiatAt,
            snapshotAt: previa.snapshotAt,
          }
        : {}),
      // Lo que el usuario borro no vuelve nunca, conecte como conecte.
      ignored: previa?.ignored,
      matched: misma ? previa?.matched : undefined,
    });
  });
  return null;
}

/**
 * Borra la clave. Lo demas queda (hasta donde se leyo, lo que el usuario
 * borro), por si vuelve a conectar: asi nada de lo que saco reaparece.
 */
export async function disconnectBinance(db: WaltraDB): Promise<void> {
  await db.connections.update("binance", { apiKey: "", secret: "", authError: undefined, blockedUntil: undefined });
}

/**
 * El usuario borro un movimiento traido de Binance: que no vuelva. Se anota
 * su id y la proxima pasada lo saltea aunque Binance lo siga mostrando.
 */
export async function forgetBinanceTx(db: WaltraDB, id: string): Promise<void> {
  if (!id.startsWith("binance-")) return;
  await db.transaction("rw", db.connections, async () => {
    const conn = await db.connections.get("binance");
    if (!conn) return;
    const ignored = [...new Set([...(conn.ignored ?? []), id])].slice(-5000);
    await db.connections.update("binance", { ignored });
  });
}

/** Desde cuando conviene traer: el ultimo dia con algo cargado en esa cuenta. */
export function defaultSince(txs: Pick<Transaction, "accountId" | "date">[], accountId: string, hoy = today()): string {
  const dias = txs.filter((t) => t.accountId === accountId).map((t) => toDay(t.date)).sort();
  if (dias.length) return dias[dias.length - 1];
  const d = new Date(`${hoy}T00:00:00`);
  d.setDate(d.getDate() - 90);
  return today(d);
}

/**
 * Lo que conviene avisar antes de conectar, segun desde cuando se va a traer.
 *
 * - El ingreso estimado de la importacion del archivo: los ingresos reales
 *   del mismo periodo lo contarian dos veces. Si se trae desde antes de su
 *   fecha, los reales lo reemplazan enteros y se puede borrar.
 * - Las correcciones de unidades (Corregir) desde esa fecha: si eran por Earn
 *   o por comisiones, ahora se traen solas.
 */
export function connectWarnings(
  txs: Pick<Transaction, "id" | "accountId" | "date" | "type" | "amount">[],
  accountId: string,
  since: string,
): { estimate?: { date: string; amount: number; replace: boolean; until: string }; adjusts: number } {
  const propios = txs.filter((t) => t.accountId === accountId);
  const adjusts = propios.filter((t) => t.type === "adjust" && !t.id.startsWith("binance-") && toDay(t.date) >= since).length;
  const estimado = propios.find((t) => t.id === CAPITAL_IMPORTADO);
  if (!estimado) return { adjusts };
  const ordenes = propios.filter((t) => /^binance-\d+$/.test(t.id)).map((t) => toDay(t.date)).sort();
  const until = ordenes[ordenes.length - 1] ?? toDay(estimado.date);
  // Desde el ultimo dia del archivo en adelante no hay periodo compartido.
  if (since >= until) return { adjusts };
  return {
    estimate: { date: toDay(estimado.date), amount: estimado.amount, replace: since <= toDay(estimado.date), until },
    adjusts,
  };
}
