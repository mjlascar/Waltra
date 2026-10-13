import { canonical, type CloudData } from "./data";

/**
 * Combina dos carteras que salieron de la misma: la ultima copia que este
 * dispositivo confirmo con Drive (`base`). Lo que cambio de un solo lado se
 * toma de ese lado, borrados incluidos; lo que cambio distinto en los dos es
 * un choque y lo decide el usuario. Asi, cargar movimientos en dos equipos sin
 * conexion no obliga a tirar los de uno.
 *
 * La historia es lineal: cada subida a Drive lleva `If-Match` sobre la version
 * que se leyo, asi que la copia remota siempre desciende de `base`.
 */

type Tx = CloudData["transactions"][number];
type AssetRow = CloudData["assets"][number];
type Settings = CloudData["settings"];
export type Side = "local" | "remote";

export interface MergeResult {
  data: CloudData;
  /** Lo que cambio distinto en los dos lados: filas, ajustes o activos enteros. */
  clashes: number;
  /** Ningun movimiento quedo apuntando a una cuenta o un activo que el otro lado borro. */
  consistent: boolean;
}

/**
 * El contenido de una fila, sin sus marcas de tiempo: guardar sin cambiar nada
 * no es un cambio, y la misma cuenta por defecto creada en dos telefonos es la
 * misma cuenta.
 */
function content(row: object | undefined): string | null {
  if (!row) return null;
  const rest: Record<string, unknown> = { ...row };
  delete rest.createdAt;
  delete rest.updatedAt;
  return JSON.stringify(canonical(rest));
}

const stable = (value: unknown): string | null => value === undefined ? null : JSON.stringify(canonical(value));
const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));

interface Decision<T> {
  id: string;
  row: T | undefined;
  clash: boolean;
  local: T | undefined;
  remote: T | undefined;
  versions: (T | undefined)[];
  /** Cambio de un lado que el otro no hizo igual. */
  localMoved: boolean;
  remoteMoved: boolean;
}

function decide<T extends { id: string }>(base: T[], local: T[], remote: T[], prefer?: Side): Decision<T>[] {
  const [b, l, r] = [byId(base), byId(local), byId(remote)];
  const ids = [...new Set([...b.keys(), ...l.keys(), ...r.keys()])].sort();
  return ids.map((id) => {
    const [vb, vl, vr] = [b.get(id), l.get(id), r.get(id)];
    const [cb, cl, cr] = [content(vb), content(vl), content(vr)];
    const agree = cl === cr;
    const localMoved = !agree && cl !== cb;
    const remoteMoved = !agree && cr !== cb;
    let row: T | undefined;
    let clash = false;
    // Con el mismo contenido gana la fila local: asi un cambio solo de marcas
    // de tiempo no reemplaza la base del telefono ni vuelve a bajar precios.
    if (agree) row = vl ?? vr;
    else if (!localMoved) row = vr;
    else if (!remoteMoved) row = vl;
    else {
      clash = true;
      row = prefer === "remote" ? vr : vl;
    }
    return { id, row, clash, local: vl, remote: vr, versions: [vb, vl, vr], localMoved, remoteMoved };
  });
}

const identity = (asset: AssetRow) =>
  [asset.symbol.toUpperCase(), asset.source, asset.sourceSymbol, asset.currency, asset.kind].join("|");

/**
 * El mismo activo dado de alta sin conexion en los dos telefonos: los ids son
 * aleatorios, asi que llegarian dos SPY.BA. Se queda uno y los movimientos del
 * otro pasan a el. Los repetidos que ya existian no se tocan.
 */
function aliases(decisions: Decision<AssetRow>[]): Map<string, string> {
  const groups = new Map<string, Decision<AssetRow>[]>();
  for (const d of decisions) {
    if (!d.row) continue;
    const key = identity(d.row);
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const alias = new Map<string, string>();
  for (const group of groups.values()) {
    const onlyLocal = group.filter((d) => !d.versions[0] && d.local && !d.remote);
    const onlyRemote = group.filter((d) => !d.versions[0] && d.remote && !d.local);
    if (!onlyLocal.length || !onlyRemote.length) continue;
    const keep = group.find((d) => d.versions[0]) ?? group[0];
    for (const d of [...onlyLocal, ...onlyRemote]) if (d.id !== keep.id) alias.set(d.id, keep.id);
  }
  return alias;
}

/**
 * Los movimientos que no conmutan. Un ajuste anota la diferencia de hoy entre
 * el broker y la app, y un split reemplaza los del activo: hechos en un
 * telefono mientras el otro cargaba operaciones del mismo activo, sumar los
 * dos lados cuenta dos veces. Ahi el choque es el activo entero.
 */
function assetClashes(txs: Decision<Tx>[], alias: Map<string, string>): Map<string, string[]> {
  interface Group { ids: string[]; local: Set<string>; remote: Set<string> }
  const groups = new Map<string, Group>();
  for (const d of txs) {
    const assets = new Set(d.versions.flatMap((v) => (v?.assetId ? [alias.get(v.assetId) ?? v.assetId] : [])));
    const types = new Set(d.versions.flatMap((v) => (v ? [v.type] : [])));
    for (const asset of assets) {
      const group = groups.get(asset) ?? { ids: [], local: new Set<string>(), remote: new Set<string>() };
      groups.set(asset, group);
      group.ids.push(d.id);
      for (const [moved, set] of [[d.localMoved, group.local], [d.remoteMoved, group.remote]] as const) {
        if (!moved) continue;
        set.add("any");
        for (const type of types) set.add(type);
      }
    }
  }
  const clashed = new Map<string, string[]>();
  for (const [asset, g] of groups) {
    const clash = (g.local.has("adjust") && g.remote.has("any")) ||
      (g.remote.has("adjust") && g.local.has("any")) ||
      (g.local.has("split") && g.remote.has("split"));
    if (clash) clashed.set(asset, g.ids);
  }
  return clashed;
}

function mergeSettings(base: Settings | undefined, local: Settings, remote: Settings, prefer?: Side) {
  const read = (s: Settings | undefined, key: string) => (s as Record<string, unknown> | undefined)?.[key];
  const keys = [...new Set([...Object.keys(base ?? {}), ...Object.keys(local), ...Object.keys(remote)])].sort();
  const out: Record<string, unknown> = {};
  let clashes = 0;
  for (const key of keys) {
    const [vb, vl, vr] = [read(base, key), read(local, key), read(remote, key)];
    const [sb, sl, sr] = [stable(vb), stable(vl), stable(vr)];
    let value: unknown;
    if (sl === sr) value = vl;
    else if (sl === sb) value = vr;
    else if (sr === sb) value = vl;
    else {
      clashes++;
      value = prefer === "remote" ? vr : vl;
    }
    if (value !== undefined) out[key] = value;
  }
  return { settings: out as Settings, clashes };
}

/** Referencias rotas: un movimiento que apunta a una cuenta o un activo que no esta. */
function dangling(data: CloudData): Set<string> {
  const accounts = new Set(data.accounts.map((a) => a.id));
  const assets = new Set(data.assets.map((a) => a.id));
  const out = new Set<string>();
  for (const t of data.transactions) {
    for (const ref of [t.accountId, t.counterAccountId]) if (ref && !accounts.has(ref)) out.add(`${t.id}>${ref}`);
    if (t.assetId && !assets.has(t.assetId)) out.add(`${t.id}>${t.assetId}`);
  }
  return out;
}

/**
 * Combina `local` y `remote` desde `base` (null: la primera conexion, donde
 * todo lo de cada lado cuenta como agregado). Con `prefer`, cada choque se
 * resuelve para ese lado; sin el, el choque queda contado y el resultado no
 * se usa.
 */
export function mergeData(base: CloudData | null, local: CloudData, remote: CloudData, prefer?: Side): MergeResult {
  const pick = <T>(decisions: Decision<T>[]) => decisions.flatMap((d) => (d.row ? [d.row] : []));
  const rowClashes = (decisions: Decision<unknown>[]) => decisions.filter((d) => d.clash).length;

  const accounts = decide(base?.accounts ?? [], local.accounts, remote.accounts, prefer);
  const assets = decide(base?.assets ?? [], local.assets, remote.assets, prefer);
  const insights = decide(base?.insights ?? [], local.insights, remote.insights, prefer);
  const txs = decide(base?.transactions ?? [], local.transactions, remote.transactions, prefer);
  const settings = mergeSettings(base?.settings, local.settings, remote.settings, prefer);

  const alias = aliases(assets);
  const clashedAssets = assetClashes(txs, alias);
  const inClashedAsset = new Set([...clashedAssets.values()].flat());
  for (const d of txs) {
    if (!inClashedAsset.has(d.id)) continue;
    // El activo entero queda como lo dejo el lado elegido.
    d.row = prefer === "remote" ? d.remote : d.local;
  }
  const transactions = pick(txs).map((t) =>
    t.assetId && alias.has(t.assetId) ? { ...t, assetId: alias.get(t.assetId) } : t);

  const data: CloudData = {
    app: "waltra", version: 1,
    accounts: pick(accounts),
    assets: pick(assets).filter((a) => !alias.has(a.id)),
    transactions,
    settings: settings.settings,
    insights: pick(insights),
  };
  const clashes = rowClashes(accounts) + rowClashes(assets) + rowClashes(insights) + settings.clashes +
    txs.filter((d) => d.clash && !inClashedAsset.has(d.id)).length + clashedAssets.size;
  const known = new Set([...dangling(local), ...dangling(remote)]);
  const consistent = [...dangling(data)].every((ref) => known.has(ref));
  return { data, clashes, consistent };
}

/**
 * Si `result` deja afuera algo que `side` cambio desde `base`. Es lo que
 * decide si hay que guardar una copia de recuperacion antes de pisar ese lado:
 * una combinacion limpia no pierde nada y no deja copias que roten las utiles.
 */
export function discards(base: CloudData | null, side: CloudData, result: CloudData): boolean {
  for (const table of ["accounts", "assets", "transactions", "insights"] as const) {
    const [b, s, r] = [byId<{ id: string }>(base?.[table] ?? []), byId<{ id: string }>(side[table]), byId<{ id: string }>(result[table])];
    for (const id of new Set([...b.keys(), ...s.keys()])) {
      const mine = content(s.get(id));
      if (mine !== content(b.get(id)) && mine !== content(r.get(id))) return true;
    }
  }
  const read = (s: Settings | undefined, key: string) => (s as Record<string, unknown> | undefined)?.[key];
  for (const key of new Set([...Object.keys(base?.settings ?? {}), ...Object.keys(side.settings)])) {
    const mine = stable(read(side.settings, key));
    if (mine !== stable(read(base?.settings, key)) && mine !== stable(read(result.settings, key))) return true;
  }
  return false;
}

/** Los datos de ejemplo (`demo.ts`) se borran de a muchos a proposito. */
const movements = (data: CloudData) => data.transactions.filter((t) => !t.id.startsWith("demo-")).length;

/**
 * Si pasar de `from` a `to` se lleva todos los movimientos, o mas de la mitad
 * de una cartera con historia. Es lo que hace un Borrar todo, o una base que
 * se perdio a medias: ninguna de las dos se aplica sin preguntar, igual que
 * una base vacia no se copia en `auto-backup.ts`. Borrar el movimiento de
 * prueba de una cartera recien empezada no es eso.
 */
export function shrinks(from: CloudData, to: CloudData): boolean {
  const [before, after] = [movements(from), movements(to)];
  return (before >= 3 && after === 0) || (before >= 10 && after < before / 2);
}
