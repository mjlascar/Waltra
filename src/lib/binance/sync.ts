import type { BinanceConnection, BinanceRunSummary, WaltraDB } from "@/lib/db";
import type { Asset, Transaction } from "@/lib/types";
import { FxTable } from "@/lib/engine/fx";
import { binanceAsset, CAPITAL_IMPORTADO } from "@/lib/parse/binance";
import { daysBetween, today, toDay } from "@/lib/date";
import { BinanceError, type BinanceClient, type BinanceTransport, type Usage } from "./client";
import * as api from "./api";
import * as map from "./map";

/**
 * Traer de Binance lo ultimo que paso, solo.
 *
 * Corre al abrir la app, al volver a ella y al tirar la pantalla para abajo
 * (ver `store.tsx`). La regla es la de quien copia a mano sus movimientos
 * nuevos: de cada historial se mira lo mas reciente, de lo mas nuevo a lo mas
 * viejo, y apenas aparece algo que ya estaba cargado se para. Lo de antes ya
 * esta, como haya quedado. Si todo lo que vino es nuevo, se pide mas atras, y
 * nunca antes del dia desde el que el usuario eligio traer.
 *
 * **Solo agrega.** Un movimiento que ya existe no se reemplaza ni se corrige,
 * venga del archivo de Binance, de una carga a mano o de una pasada anterior:
 * si el usuario lo dejo asi, por algo sera. Y nada de revisar la historia
 * entera: las ordenes spot se miran solo en los pares del activo cuyo saldo
 * cambio desde la pasada anterior.
 *
 * Binance limita lo que se le puede pedir por minuto y banea la IP que
 * insiste. La pasada lleva la cuenta con lo que dicen sus cabeceras y, si se
 * acerca al limite, guarda lo que tiene y sigue en la proxima.
 */

/** Entre una pasada y la siguiente, como minimo. Tirar la pantalla seguido solo actualiza precios. */
export const MIN_INTERVAL = 45_000;
/** "Traer ahora" no espera el minimo, pero tampoco pregunta dos veces seguidas. */
const MIN_FORCED = 10_000;
/** Las compras con tarjeta cambian poco: unas veces por dia alcanza. */
const SLOW_EVERY = 6 * 3_600_000;
/** El historial en pesos pesa 45.000 por pedido: una vez por dia. */
const DAILY = 24 * 3_600_000;
/** Contra que se cotiza lo que haya en la cuenta. */
const QUOTES = ["USDT", "FDUSD", "USDC", "TUSD", "BUSD", "DAI", "ARS", "BTC", "ETH", "BNB"];
/**
 * De cada par se piden las ultimas ordenes, de a poco: si todas son nuevas,
 * se pide de nuevo, mas. Binance cobra lo mismo por 10 que por 1000, pero lo
 * normal es que entre una pasada y la siguiente haya pocas, y una respuesta
 * chica es una respuesta rapida.
 */
const PAGES = [10, 20, 50, 100, 1000];
/** Lo que una pasada se permite gastar del limite por minuto, con margen. */
const BUDGET: Usage = { ip: 4000, sapiIp: 9000, uid: 120_000 };
/** Un mes de Earn se carga una vez, unos dias despues de que termino. */
const EARN_GRACE = 3 * api.DAY;

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

/** Una orden que sigue abierta todavia puede ejecutarse mas: se carga cuando termine. */
const abierta = (status: string) => status === "NEW" || status === "PARTIALLY_FILLED" || status === "PENDING_NEW";

/** La lista de pares cambia muy de vez en cuando: se guarda unas horas por transporte. */
const symbolCache = new WeakMap<BinanceTransport, { at: number; set: Set<string> }>();

async function symbolsOf(client: BinanceClient, at: number): Promise<Set<string>> {
  const hit = symbolCache.get(client.transport);
  if (hit && at - hit.at < SLOW_EVERY && at >= hit.at) return hit.set;
  const set = await api.symbols(client);
  symbolCache.set(client.transport, { at, set });
  return set;
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
 * Lo que ya hay en la base, para saber que de lo que manda Binance ya
 * estaba: por id (el archivo de ordenes usa el mismo), porque el usuario lo
 * borro, o porque lo habia cargado a mano.
 */
class Book {
  private readonly ids: Set<string>;
  private readonly ignored: Set<string>;
  private readonly manual: Transaction[];
  private readonly usados: Set<string>;
  readonly matched: Record<string, string>;
  dupes = 0;

  constructor(
    txs: Transaction[],
    private readonly assets: Asset[],
    private readonly fx: FxTable,
    conn: BinanceConnection,
  ) {
    this.ids = new Set(txs.map((t) => t.id));
    this.ignored = new Set(conn.ignored ?? []);
    this.manual = txs.filter((t) => !t.id.startsWith("binance-") && t.accountId === conn.accountId);
    this.matched = { ...(conn.matched ?? {}) };
    this.usados = new Set(Object.values(this.matched));
  }

  knownId(id: string): boolean {
    return this.ids.has(id) || this.ignored.has(id);
  }

  /** Si ya estaba. Si estaba cargado a mano, la pareja queda anotada. */
  known(g: map.Group): boolean {
    if (g.drafts.some((d) => this.knownId(d.id))) return true;
    const a = anchorOf(g);
    if (!a) return false;
    const previo = this.matched[a.id];
    if (previo && this.ids.has(previo)) return true;
    const gemelo = this.twin(g, a);
    if (!gemelo) return false;
    this.matched[a.id] = gemelo.id;
    this.usados.add(gemelo.id);
    this.dupes += 1;
    return true;
  }

  private usdOf(amount: number, currency: string, day: string, fxRate?: number): number {
    return currency === "USD" ? amount : amount / (fxRate || this.fx.at(day) || NaN);
  }

  /**
   * Lo mismo cargado a mano, lo mas parecido que haya: mismo tipo, dias
   * cercanos, y las mismas unidades del mismo activo (una compra, una cripto
   * que llego) o el mismo monto (un ingreso, un retiro). Cada cosa cargada a
   * mano cubre a un solo registro de Binance.
   */
  private twin(g: map.Group, a: map.Draft): Transaction | undefined {
    const day = localDay(a.at);
    const trade = a.type === "buy" || a.type === "sell";
    const assetId = a.symbol ? findCrypto(this.assets, a.symbol)?.id : undefined;
    if (trade && !assetId) return undefined;
    // Una orden del libro tiene fecha cierta; lo que viene de otra billetera puede tardar.
    const tol = /^binance-\d+$/.test(a.id) ? 1 : 3;
    const rate = g.drafts.find((d) => d.fxRate)?.fxRate;
    const valor = this.usdOf(a.amount, a.currency, day, a.fxRate ?? rate);
    let best: { t: Transaction; score: number } | undefined;
    for (const t of this.manual) {
      if (this.usados.has(t.id) || t.type !== a.type) continue;
      const dias = Math.abs(daysBetween(toDay(t.date), day));
      if (dias > tol) continue;
      let diff: number;
      if (trade) {
        if (t.assetId !== assetId || !close(t.quantity ?? 0, a.quantity ?? 0, 0.02)) continue;
        diff = Math.abs((t.quantity ?? 0) - (a.quantity ?? 0)) / Math.max(a.quantity ?? 1, 1e-12);
      } else {
        const suyo = this.usdOf(t.amount, t.currency, toDay(t.date), t.fxRate);
        if (!close(suyo, valor, 0.03)) continue;
        diff = Math.abs(suyo - valor) / Math.max(valor, 1e-12);
      }
      const score = diff * 100 + dias;
      if (!best || score < best.score) best = { t, score };
    }
    return best?.t;
  }
}

/** La cripto ya cargada con ese simbolo, si hay. */
function findCrypto(assets: Asset[], symbol: string): Asset | undefined {
  const s = symbol.toUpperCase();
  const cripto = (a: Asset) => a.symbol.toUpperCase() === s && (a.kind === "crypto" || a.source === "binance");
  return assets.find((a) => cripto(a) && !a.archived) ?? assets.find(cripto);
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

  // Nada de antes de esto, aunque lo que vino despues sea todo nuevo.
  const floor = localMidnight(conn.since);
  const [txs, assets, fxRows] = await Promise.all([db.transactions.toArray(), db.assets.toArray(), db.fx.toArray()]);
  const book = new Book(txs, assets, new FxTable(fxRows, 0), conn);

  let queue = [...(conn.queue ?? [])];
  let balances = conn.balances;
  let locked = conn.locked;
  let uid = conn.uid;
  let { slowAt, fiatAt } = conn;
  let earnFrom = conn.cursors?.earn;
  const resume: Record<string, number> = { ...(conn.resume ?? {}) };
  const found = new Map<string, map.Group>();
  const skipped: string[] = [];
  let partial = false;
  let progress = false;
  let fatal: BinanceError | null = null;

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

  /** Lo nuevo de algo que se leyo entero (una ventana de tiempo, un par, un mes de Earn). */
  const keep = (groups: map.Group[]) => {
    for (const g of groups) if (!found.has(g.drafts[0].id)) found.set(g.drafts[0].id, g);
  };

  /**
   * Recorre de lo mas nuevo a lo mas viejo, juntando lo nuevo hasta llegar a
   * algo que ya estaba o al punto de partida. Devuelve si paro.
   */
  async function walk<T>(
    items: T[],
    time: (x: T) => number,
    handle: (x: T) => Promise<map.Mapped> | map.Mapped,
    into: map.Group[],
  ): Promise<boolean> {
    for (const x of [...items].sort((a, b) => time(b) - time(a))) {
      if (time(x) < floor) return true;
      const m = await handle(x);
      // Pendiente o sin nada que registrar: todavia no es ni nuevo ni viejo.
      if (!m) continue;
      if ("skip" in m) {
        skipped.push(m.skip);
        continue;
      }
      if (book.known(m)) return true;
      into.push(m);
    }
    return false;
  }

  /**
   * Un historial por ventanas de tiempo, de la mas nueva para atras, hasta
   * llegar a lo que ya estaba. Casi siempre alcanza con la primera.
   *
   * Lo nuevo de cada ventana se guarda apenas se lee la ventana entera. Si la
   * pasada se corta antes de llegar a lo que ya estaba, queda anotado desde
   * donde seguir para atras: la proxima pasada pararia en lo recien guardado y
   * lo mas viejo no entraria nunca.
   */
  async function recent<T>(
    name: string,
    win: number,
    cost: Partial<Usage>,
    fetch: (s: number, e: number) => Promise<T[]>,
    time: (x: T) => number,
    handle: (x: T) => Promise<map.Mapped> | map.Mapped,
    floorHere = floor,
  ): Promise<boolean> {
    let end = 0;
    /** Recorre hacia atras desde `desde`. Devuelve si llego al final (lo que ya estaba o el punto de partida). */
    const range = async (desde: number): Promise<boolean> => {
      for (end = desde; end >= floorHere; ) {
        const start = Math.max(floorHere, end - win + 1);
        if (!roomFor(cost)) {
          partial = true;
          return false;
        }
        let items: T[];
        try {
          items = await fetch(start, end);
        } catch (err) {
          if (corta(err)) throw err;
          // Un historial que esta clave o esta cuenta no puede leer (por pais,
          // por permisos) no frena a los demas.
          skipped.push(`No pude leer ${name}: ${messageOf(err)}`);
          return false;
        }
        const nuevos: map.Group[] = [];
        const paro = await walk(items, time, handle, nuevos);
        keep(nuevos);
        progress = true;
        if (paro) return true;
        end = start - 1;
      }
      return true;
    };
    try {
      // Primero lo que quedo pendiente de una pasada cortada, despues lo nuevo.
      if (resume[name] !== undefined) {
        if (!(await range(resume[name]))) {
          resume[name] = end;
          return false;
        }
        delete resume[name];
      }
      if (!(await range(t0))) {
        resume[name] = end;
        return false;
      }
      return true;
    } catch (err) {
      // La ventana que se estaba leyendo no se guardo: se sigue desde ella.
      resume[name] = end;
      if (err instanceof OutOfBudget) {
        partial = true;
        return false;
      }
      throw err;
    }
  }

  /**
   * Las ultimas ordenes de un par, de la mas nueva para atras, hasta una que
   * ya estaba. Si las diez ultimas son todas nuevas, se piden 20, despues 50,
   * 100 y hasta 1000.
   *
   * Un par entra entero o no entra: si se guardaran las ordenes nuevas de
   * arriba y no las de abajo, la proxima pasada pararia en las de arriba. Por
   * eso, antes de bajar el detalle de cada orden, se cuenta cuantas son y si
   * no alcanza el cupo de esta pasada, el par espera a la proxima.
   */
  async function scanPair(key: string): Promise<"done" | "cut"> {
    const [base, quote] = key.split("/");
    const symbol = `${base}${quote}`;
    let orders: api.OrderInfo[] = [];
    for (const limit of PAGES) {
      if (!roomFor({ ip: 20 })) return "cut";
      try {
        orders = await api.recentOrders(client, symbol, limit);
      } catch (err) {
        if (corta(err)) throw err;
        skipped.push(`No pude leer las órdenes de ${key}: ${messageOf(err)}`);
        return "done";
      }
      // Las que podrian ser nuevas: hasta la primera que ya esta o el punto de partida.
      const hasta = orders.findIndex((o) => o.updateTime < floor || book.knownId(map.orderId(o)));
      if (hasta !== -1 || orders.length < limit) break;
      if (limit === PAGES[PAGES.length - 1]) {
        skipped.push(`${key}: hay más de ${limit} órdenes nuevas; las más viejas van con el archivo de órdenes.`);
      }
      // Todas nuevas: puede haber mas. Se piden de nuevo, mas.
    }
    const hasta = orders.findIndex((o) => o.updateTime < floor || book.knownId(map.orderId(o)));
    // Cancelada sin ejecutarse: no hay nada que cargar. Abierta: se carga
    // cuando termine (o cuando se cancele lo que falta).
    const candidatas = (hasta === -1 ? orders : orders.slice(0, hasta)).filter(
      (o) => o.executedQty > 0 && !abierta(o.status),
    );
    const costo = candidatas.length * 5 + 60;
    if (!roomFor({ ip: costo })) {
      // Si entra en una pasada con el cupo entero, espera a la proxima. Si ni
      // asi entra, se traen las mas nuevas que entren y se avisa del resto.
      if (costo <= BUDGET.ip / 2) return "cut";
      skipped.push(`${key}: demasiadas órdenes nuevas para traer solas; las más viejas van con el archivo de órdenes.`);
    }
    const nuevos: map.Group[] = [];
    for (const o of candidatas) {
      if (!roomFor({ ip: 11 })) break;
      const [orden] = map.ordersFromFills(base, quote, await api.orderFills(client, symbol, o.orderId));
      const m = orden ? await map.orderGroup(orden, usd) : null;
      if (!m) continue;
      if ("skip" in m) {
        skipped.push(m.skip);
        continue;
      }
      // Cargada a mano: de ahi para atras ya esta.
      if (book.known(m)) break;
      nuevos.push(m);
    }
    keep(nuevos);
    return "done";
  }

  /** Earn: cada mes, una vez, cuando ya termino. Nunca se rearma un movimiento que ya esta. */
  async function earn(): Promise<boolean> {
    let from = Math.max(floor, earnFrom ?? floor);
    for (;;) {
      const [ms, me] = monthBounds(from);
      if (me + EARN_GRACE >= t0) return true;
      const records: api.Reward[] = [];
      for (const [s, e] of api.windows(Math.max(ms, floor), me, api.WINDOW.rewards)) {
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
      const mes: map.Group[] = [];
      for (const [asset, total] of totals) {
        const m = map.earnGroup(asset, monthKey(ms), total);
        if (!m) continue;
        if ("skip" in m) skipped.push(m.skip);
        else if (!m.drafts.some((d) => book.knownId(d.id))) mes.push(m);
      }
      keep(mes);
      progress = true;
      earnFrom = me + 1;
      from = me + 1;
    }
  }

  try {
    const cuenta = await api.spotAccount(client);
    if (uid && cuenta.uid && uid !== cuenta.uid) {
      throw new BinanceError("Esta clave es de otra cuenta de Binance: conectala de nuevo para empezar con esa cuenta.", "auth");
    }
    uid = cuenta.uid ?? uid;
    const antes = balances;
    const antesBloqueado = locked ?? {};
    balances = cuenta.balances;
    locked = cuenta.locked;

    // Los pares a mirar: los del activo cuyo saldo cambio (o lo bloqueado en
    // ordenes: una orden a medias que se cancela no cambia el total). La
    // primera vez, o con "Traer ahora", los de lo que hay en la cuenta. Entran
    // a la cola ya: si la pasada se corta despues, la cola guardada se acuerda.
    const mirar = new Set<string>();
    /** Activos con plata bloqueada que se libero: una orden de compra que termino los usaba para pagar. */
    const desbloqueados = new Set<string>();
    const enLaCuenta = new Set<string>(Object.keys(balances));
    const porId = new Map(assets.map((a) => [a.id, a]));
    for (const t of txs) {
      const a = t.accountId === conn.accountId && t.assetId ? porId.get(t.assetId) : undefined;
      if (a?.kind === "crypto") enLaCuenta.add(a.symbol.toUpperCase());
    }
    if (!antes || options.force) {
      for (const a of enLaCuenta) mirar.add(a);
    } else {
      for (const a of new Set([...Object.keys(antes), ...Object.keys(balances)])) {
        if (!close(antes[a] ?? 0, balances[a] ?? 0, 1e-9)) mirar.add(a);
      }
      for (const a of new Set([...Object.keys(antesBloqueado), ...Object.keys(locked)])) {
        if (!close(antesBloqueado[a] ?? 0, locked[a] ?? 0, 1e-9)) {
          mirar.add(a);
          desbloqueados.add(a);
        }
      }
    }
    if (mirar.size > 0) {
      const existentes = await symbolsOf(client, t0);
      const par = (b: string, q: string) => (b !== q && existentes.has(`${b}${q}`) ? [`${b}/${q}`] : []);
      const pares = [
        ...[...mirar].flatMap((b) => QUOTES.flatMap((q) => par(b, q))),
        // Una compra que termino o se cancelo libera la moneda con que se
        // pagaba: se miran los pares donde esa moneda es la cotizacion.
        ...[...desbloqueados].flatMap((q) => [...enLaCuenta].flatMap((b) => par(b, q))),
      ];
      queue = [...new Set([...pares, ...queue])];
    }

    // Lo que pesa mucho va primero, mientras el cupo del minuto esta entero.
    if (due(fiatAt, DAILY)) {
      const antesDeFiat = skipped.length;
      const listo = await recent("los ingresos en pesos", api.WINDOW.fiat, { uid: 90_000 },
        (s, e) => api.fiatOrders(client, s, e), (o) => o.time, (o) => map.fiatGroup(o));
      // Si la cuenta no tiene ese historial, tampoco se insiste hasta mañana.
      if (listo || skipped.length > antesDeFiat) fiatAt = t0;
    }

    await recent("los ingresos", api.WINDOW.deposits, { sapiIp: 1 }, (s, e) => api.deposits(client, s, e),
      (d) => d.time, (d) => map.depositGroup(d, usd));
    await recent("los retiros", api.WINDOW.withdrawals, { uid: 18_000 }, (s, e) => api.withdrawals(client, s, e),
      (w) => w.time, (w) => map.withdrawalGroup(w, usd));
    await recent("Convert", api.WINDOW.converts, { uid: 3_000 }, (s, e) => api.converts(client, s, e),
      (c) => c.time, (c) => map.convertGroup(c, usd));
    // Binance da solo seis meses de P2P: lo de antes, si hace falta, va a mano.
    await recent("P2P", api.WINDOW.p2p, { sapiIp: 2 }, (s, e) => api.p2pOrders(client, s, e),
      (o) => o.time, (o) => map.p2pGroup(o, usd), Math.max(floor, t0 - api.P2P_HISTORY + api.DAY));

    if (options.force || due(slowAt, SLOW_EVERY)) {
      const pagos = await recent("las compras con tarjeta", api.WINDOW.fiat, { sapiIp: 1 },
        (s, e) => api.fiatPayments(client, s, e), (p) => p.time, (p) => map.paymentGroup(p, usd));
      const ganancias = await earn();
      if (pagos && ganancias) slowAt = t0;
    }

    while (queue.length > 0) {
      if ((await scanPair(queue[0])) === "cut") {
        partial = true;
        break;
      }
      queue.shift();
      progress = true;
    }
  } catch (err) {
    if (err instanceof OutOfBudget) partial = true;
    else if (err instanceof BinanceError) fatal = err;
    else fatal = new BinanceError(messageOf(err), "api");
  }

  const lastRunAt = new Date(t0).toISOString();
  const patch: Partial<BinanceConnection> = {
    cursors: { ...conn.cursors, earn: earnFrom },
    resume,
    balances,
    locked,
    queue,
    uid,
    slowAt,
    fiatAt,
    authError: fatal?.kind === "auth" ? describeError(fatal) : undefined,
    blockedUntil: fatal?.kind === "rate" ? t0 + (fatal.retryAfter ?? 60) * 1000 : undefined,
  };
  return write(db, [...found.values()], book, patch, (w) => ({
    at: lastRunAt,
    added: w.added,
    updated: 0,
    dupes: book.dupes,
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
 * Agrega lo nuevo y guarda el estado de la conexion en una sola transaccion.
 * Lo que ya existe no se toca: si un id ya esta (o el usuario lo borro), ese
 * grupo entero se saltea. La conexion se relee adentro: un borrado hecho
 * mientras corria la pasada no se pisa.
 */
async function write(
  db: WaltraDB,
  groups: map.Group[],
  book: Book,
  patch: Partial<BinanceConnection>,
  summary: (w: { added: number }) => BinanceRunSummary,
): Promise<RunResult | null> {
  const nowIso = new Date().toISOString();
  let result: RunResult | null = null;

  await db.transaction("rw", [db.transactions, db.assets, db.connections], async () => {
    const conn = await db.connections.get("binance");
    // Desconectada o borrada mientras corria: no se escribe nada.
    if (!conn?.apiKey) return;
    const ignored = new Set(conn.ignored ?? []);
    const existing = new Set((await db.transactions.toCollection().primaryKeys()) as string[]);
    const assets = await db.assets.toArray();
    const nuevos: Asset[] = [];
    const puts: Transaction[] = [];

    /** El activo de un simbolo de Binance: la cripto ya cargada, o una nueva. */
    const assetFor = (symbol: string): string => {
      const found = findCrypto(assets, symbol);
      if (found) return found.id;
      const asset = binanceAsset(symbol.toUpperCase(), newId());
      assets.push(asset);
      nuevos.push(asset);
      return asset.id;
    };

    const ordenados = [...groups].sort(
      (a, b) => Math.min(...a.drafts.map((d) => d.at)) - Math.min(...b.drafts.map((d) => d.at)),
    );
    for (const g of ordenados) {
      if (g.drafts.some((d) => ignored.has(d.id) || existing.has(d.id))) continue;
      for (const d of g.drafts) {
        puts.push(toTx(d, conn.accountId, d.symbol ? assetFor(d.symbol) : undefined, nowIso));
        existing.add(d.id);
      }
    }

    if (nuevos.length) await db.assets.bulkPut(nuevos);
    if (puts.length) await db.transactions.bulkPut(puts);
    const lastRun = summary({ added: puts.length });
    await db.connections.update("binance", {
      ...patch,
      matched: { ...(conn.matched ?? {}), ...book.matched },
      lastRun,
    });
    result = { ...lastRun, newAssets: nuevos.length };
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
      // De la misma cuenta se sigue sabiendo que meses de Earn ya se cargaron.
      cursors: misma && previa ? { earn: previa.cursors?.earn } : {},
      // Lo que el usuario borro no vuelve nunca, conecte como conecte.
      ignored: previa?.ignored,
      matched: misma ? previa?.matched : undefined,
    });
  });
  return null;
}

/**
 * Borra la clave. Lo demas queda (lo que el usuario borro, lo que estaba
 * cargado a mano), por si vuelve a conectar: asi nada de lo que saco reaparece.
 */
export async function disconnectBinance(db: WaltraDB): Promise<void> {
  await db.connections.update("binance", { apiKey: "", secret: "", authError: undefined, blockedUntil: undefined });
}

/**
 * El usuario borro un movimiento traido de Binance: que no vuelva. Se anota
 * su id y la proxima pasada lo cuenta como algo que ya estaba.
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

/**
 * Desde cuando conviene traer: el ultimo dia con algo cargado en esa cuenta.
 * Sin nada cargado, el ultimo mes: lo de antes, si hace falta, es una decision
 * del usuario, no algo que la app traiga sola.
 */
export function defaultSince(txs: Pick<Transaction, "accountId" | "date">[], accountId: string, hoy = today()): string {
  const dias = txs.filter((t) => t.accountId === accountId).map((t) => toDay(t.date)).sort();
  if (dias.length) return dias[dias.length - 1];
  const d = new Date(`${hoy}T00:00:00`);
  d.setDate(d.getDate() - 30);
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
