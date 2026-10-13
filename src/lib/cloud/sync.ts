import type { CloudBackup, CloudState, WaltraDB } from "@/lib/db";
import { CloudFormatError, decodeData, encodeData, isPristine, readData, replaceData, type CloudData } from "./data";
import type { CloudTransport, CloudVersion } from "./drive";
import { CHAIN_LENGTH, versionToken } from "./drive";
import { GoogleError } from "./google";
import { discards, mergeData, shrinks } from "./merge";

/** Por que se freno la sincronizacion: decide que se le explica al usuario. */
export type ConflictKind =
  /** Primera conexion de este dispositivo, con datos propios y en Drive. */
  | "first"
  /** Los dos lados cambiaron lo mismo desde la ultima sincronizacion. */
  | "both"
  /** El resultado se llevaria la mayor parte de los movimientos. */
  | "shrink"
  /** La copia de Drive desaparecio despues de haber sincronizado. */
  | "missing"
  /** Varias copias en Drive: dos primeras conexiones a la vez. */
  | "copies";

/**
 * Que hace cada salida: reemplazar con un lado entero, combinar dejando que un
 * lado gane los choques, juntar los dos en la primera conexion o confirmar un
 * borrado grande.
 */
export type OptionKind = "device" | "drive" | "device-wins" | "drive-wins" | "join" | "apply";

export interface ConflictOption {
  id: string;
  kind: OptionKind;
  payload: string;
  transactions: number;
  /** La fecha de la copia de Drive, cuando la opcion es una de ellas. */
  at?: string;
  /**
   * La copia de Drive de la que sale el resultado, si sale de una: con ella
   * sigue la cadena de subidas. Quedarse con este dispositivo entero no sale
   * de ninguna.
   */
  parent?: string;
}

export interface CloudConflict {
  status: "conflict";
  kind: ConflictKind;
  local: string;
  versions: CloudVersion[];
  options: ConflictOption[];
  /** Lo que cambio distinto en los dos lados (solo en `both`). */
  clashes: number;
}

export type CloudSyncResult = { status: "ok" | "pending"; at: string; downloaded: boolean } | CloudConflict;
export interface Resolution { local: string; tokens: string[]; choice: string }

export class CloudOwnerError extends Error {
  constructor(linked?: string) {
    super(`Esta instalación está vinculada a otra cuenta de Google${linked ? ` (${linked})` : ""}. Conectá esa cuenta, o desvinculá la instalación para usar otra.`);
  }
}

/**
 * Olvida la cuenta y la ultima copia confirmada. Los datos quedan como estan,
 * aca y en ese Drive; la proxima conexion es una primera conexion.
 */
export async function unlinkCloud(db: WaltraDB): Promise<void> {
  await db.cloudState.delete("cloud");
}

export async function setPaused(db: WaltraDB, paused: boolean): Promise<void> {
  await db.cloudState.update("cloud", { paused });
}

/** Copias de recuperacion que se guardan en el dispositivo. Drive no conserva versiones. */
export const MAX_RECOVERY = 3;

/** `parent`: la copia de Drive de la que sale `selected`, como en `ConflictOption`. */
type Plan = { selected: string; parent?: CloudVersion } | Omit<CloudConflict, "status" | "local" | "versions">;

function option(kind: OptionKind, payload: string, version?: CloudVersion, parent?: CloudVersion): ConflictOption {
  return {
    id: version ? `${kind}:${version.id}` : kind, kind, payload,
    transactions: decodeData(payload).transactions.length,
    ...(version ? { at: version.at } : {}),
    ...(parent ? { parent: parent.id } : {}),
  };
}

/**
 * Una opcion que sale de combinar con `parent`. Si la combinacion pasa el
 * limite de 5 MiB no se ofrece, en vez de trabar la sincronizacion antes de
 * preguntar.
 */
function combined(kind: OptionKind, data: CloudData, parent: CloudVersion, version?: CloudVersion): ConflictOption[] {
  try {
    return [option(kind, encodeData(data), version, parent)];
  } catch (err) {
    if (err instanceof CloudFormatError) return [];
    throw err;
  }
}

/**
 * Que hacer con `local` y las copias de Drive, sabiendo cual fue la ultima
 * confirmada (`base`). Es una funcion pura: una resolucion se vuelve a calcular
 * con los datos de ese momento y tiene que dar las mismas opciones.
 */
function plan(base: string | null, local: string, versions: CloudVersion[]): Plan {
  const remote = versions[0]?.payload ?? null;
  const head = versions[0];
  if (new Set(versions.map((v) => v.payload)).size > 1) {
    return { kind: "copies", clashes: 0, options: [option("device", local), ...versions.map((v) => option("drive", v.payload, v, v))] };
  }
  if (remote === local) return { selected: local, parent: head };
  if (remote === null) {
    // La copia remota desaparecio. No se vuelve a subir nada sin preguntar.
    if (base !== null) return { kind: "missing", clashes: 0, options: [option("device", local)] };
    return { selected: local };
  }
  if (base === null) {
    if (isPristine(local)) return { selected: remote, parent: head };
    // Juntar sin una base comun puede repetir lo que se cargo en los dos
    // lados por separado: se ofrece, pero no se hace solo. Y solo si no hay
    // nada que choque: "suma los de los dos lados" no puede tirar ninguno.
    const joined = mergeData(null, decodeData(local), decodeData(remote));
    return { kind: "first", clashes: 0, options: [
      option("device", local), option("drive", remote, head, head),
      ...(joined.clashes === 0 && joined.consistent ? combined("join", joined.data, head) : []),
    ] };
  }
  const [b, l, r] = [decodeData(base), decodeData(local), decodeData(remote)];
  const merged = mergeData(b, l, r);
  if (merged.clashes > 0 || !merged.consistent) {
    const wins = (prefer: "local" | "remote") => {
      const whole = prefer === "local" ? option("device", local) : option("drive", remote, head, head);
      const result = mergeData(b, l, r, prefer);
      // Si ni asi cierra (un movimiento nuevo de un activo que el otro lado
      // borro), queda elegir un lado entero.
      if (!result.consistent) return [whole];
      const options = combined(prefer === "local" ? "device-wins" : "drive-wins", result.data, head, prefer === "local" ? undefined : head);
      return options.length ? options : [whole];
    };
    return { kind: "both", clashes: merged.clashes, options: [...wins("local"), ...wins("remote")] };
  }
  if (shrinks(l, merged.data) || shrinks(r, merged.data)) {
    const keep = l.transactions.length >= r.transactions.length ? option("device", local) : option("drive", remote, head, head);
    return { kind: "shrink", clashes: 0, options: [...combined("apply", merged.data, head), keep] };
  }
  return { selected: encodeData(merged.data), parent: head };
}

/** Guarda lo que se va a pisar, sin repetir copias iguales y quedandose con las ultimas. */
async function saveRecovery(db: WaltraDB, copies: Pick<CloudBackup, "payload" | "origin">[], at: string): Promise<void> {
  await db.transaction("rw", db.cloudBackups, async () => {
    const saved = await db.cloudBackups.toArray();
    for (const copy of copies) {
      if (saved.some((s) => s.payload === copy.payload)) continue;
      await db.cloudBackups.add({ at, ...copy });
    }
    const all = await db.cloudBackups.orderBy("id").primaryKeys();
    await db.cloudBackups.bulkDelete(all.slice(0, Math.max(0, all.length - MAX_RECOVERY)));
  });
}

/**
 * Lee Drive, combina con lo local desde la ultima copia confirmada y escribe
 * de los dos lados lo que haga falta. Lo que cambio distinto en los dos lados,
 * o un borrado de casi todo, se frena y lo decide el usuario; nunca el reloj
 * del telefono. Una sola copia en Drive; el transporte controla la revision
 * antes de sobrescribir.
 */
export async function synchronize(
  db: WaltraDB, transport: CloudTransport, owner: string,
  active: () => boolean, resolution?: Resolution, email?: string,
): Promise<CloudSyncResult> {
  const pending = (): CloudSyncResult => ({ status: "pending", at: new Date().toISOString(), downloaded: false });
  const state = await db.transaction("rw", db.cloudState, async () => {
    if (!active()) return null;
    const current = await db.cloudState.get("cloud");
    if (current && current.owner !== owner) throw new CloudOwnerError(current.email);
    const row: CloudState = current ?? { id: "cloud", owner, base: null, ...(email ? { email } : {}) };
    if (!current) await db.cloudState.put(row);
    return row;
  });
  if (!state) return pending();
  let current: CloudState = state;
  const local = await readData(db);
  let read: CloudVersion[];
  const known = state.base !== null && state.remote ? { ...state.remote, payload: state.base, at: "" } : undefined;
  try { read = await transport.read(known); }
  catch (err) { if (err instanceof GoogleError && [404, 412].includes(err.status ?? 0)) return pending(); throw err; }
  const versions = read.map((version) => ({
    ...version, payload: encodeData(decodeData(version.payload)),
  }));
  if (!active()) return pending();
  // Si la pasada anterior subio y no llego a anotarlo (se perdio la respuesta,
  // se cerro la app), lo que hay en Drive sale de `sending.base`, y ese es el
  // ancestro comun: con la base vieja, lo que se borro aca despues de subirlo
  // volveria como si lo hubiera agregado otro equipo. La cadena de la copia lo
  // dice aunque otro equipo haya subido encima, y se anota en el acto: si esta
  // pasada choca con otra subida, no se puede volver a perder.
  const sending = state.sending;
  if (sending && versions.length === 1 && versions[0].chain?.includes(sending.id)) {
    const settled = await db.transaction("rw", db.cloudState, async () => {
      const row = await db.cloudState.get("cloud");
      if (row?.owner !== owner || row.base !== state.base || row.sending?.id !== sending.id) return null;
      const next: CloudState = { ...row, base: sending.base, remote: undefined, sending: undefined };
      await db.cloudState.put(next);
      return next;
    });
    if (!settled) return pending();
    current = settled;
  }
  const baseline = current.base;
  const tokens = versions.map(versionToken).sort();
  const decision = plan(baseline, local, versions);
  let selected: string;
  let parent: CloudVersion | undefined;

  if ("selected" in decision) {
    // Tambien con una resolucion en mano: si lo que llego despues ya se puede
    // combinar solo, no hay nada que preguntar.
    selected = decision.selected;
    parent = decision.parent;
  } else {
    const conflict: CloudConflict = { status: "conflict", local, versions, ...decision };
    // Una confirmacion vieja no autoriza pisar cambios que llegaron despues.
    if (!resolution || resolution.local !== local || JSON.stringify([...resolution.tokens].sort()) !== JSON.stringify(tokens)) return conflict;
    const chosen = decision.options.find((o) => o.id === resolution.choice);
    if (!chosen) return conflict;
    selected = chosen.payload;
    parent = versions.find((v) => v.id === chosen.parent);
  }

  const result = decodeData(selected); // Limite y forma comprobados antes de cualquier escritura.
  const base = baseline === null ? null : decodeData(baseline);
  // Un lado pierde algo si el resultado deja afuera lo que ese lado cambio, o
  // si se confirmo un borrado grande: esos datos no quedan en ningun otro lado.
  const loses = (side: string) => {
    const data = decodeData(side);
    return discards(base, data, result) || shrinks(data, result);
  };
  const remote = versions[0]?.payload ?? null;
  const at = new Date().toISOString();
  let confirmed: CloudVersion | undefined = versions[0];
  let uploaded = false;
  if (selected !== remote || versions.length > 1) {
    // Lo que se va a perder se guarda antes de subir, de los dos lados: Drive
    // no conserva la version anterior, y si despues no se puede aplicar aca,
    // la pasada siguiente ya no lo ve como algo que se pierde.
    const lost: Pick<CloudBackup, "payload" | "origin">[] = [
      ...(selected !== local && !isPristine(local) && loses(local) ? [{ payload: local, origin: "device" as const }] : []),
      ...versions.filter((v) => v.payload !== selected && loses(v.payload)).map((v) => ({ payload: v.payload, origin: "drive" as const })),
    ];
    if (lost.length) await saveRecovery(db, lost, at);
    if (!active()) return pending();
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
    await db.cloudState.update("cloud", { sending: { base: local, id } });
    // La cadena sigue solo si lo que se sube sale de esa copia. Quedarse con
    // este dispositivo entero reemplaza lo que habia: heredar su cadena le
    // haria creer a un telefono con una subida pendiente que su copia sigue
    // ahi abajo, y borraria lo suyo sin preguntar.
    const chain = [...(parent?.chain ?? []), id].slice(-CHAIN_LENGTH);
    try { confirmed = await transport.write(selected, versions, chain); uploaded = true; }
    catch (err) { if (err instanceof GoogleError && [404, 412].includes(err.status ?? 0)) return pending(); throw err; }
  }

  return db.transaction("rw", db.tables, async () => {
    const currentState = await db.cloudState.get("cloud");
    // Se desvinculo o se cambio de cuenta mientras tanto: no se confirma nada.
    if (currentState?.owner !== owner) return pending();
    // Otra pestana termino antes. Su baseline manda; releer en la proxima pasada.
    if (currentState.base !== current.base) return pending();
    const settle = (confirmedBase: string, revision?: CloudVersion) => db.cloudState.put({
      ...currentState, base: confirmedBase, syncedAt: at, sending: undefined,
      remote: revision && { id: revision.id, etag: revision.etag, chain: revision.chain },
    });
    const currentLocal = await readData(db);
    if (selected !== local && (!active() || currentLocal !== local)) {
      // Lo combinado no se puede aplicar aca: se desconecto, o hubo cambios
      // mientras subia. Si ya se subio, Drive tiene algo que sale de `local`:
      // ese es el ancestro comun para la proxima pasada. Sin la revision, la
      // proxima pasada baja la copia en vez de suponer que es `local`.
      if (uploaded) await settle(local);
      return pending();
    }
    if (!active()) {
      // Se desconecto despues de subir lo de este dispositivo: queda anotado.
      if (uploaded) await settle(selected, confirmed);
      return pending();
    }
    let downloaded = false;
    if (selected !== local) {
      if (!isPristine(local) && loses(local)) {
        await saveRecovery(db, [{ payload: local, origin: "device" }], at);
      }
      await replaceData(db, selected);
      downloaded = true;
    }
    await settle(selected, confirmed);
    return { status: selected === currentLocal || downloaded ? "ok" : "pending", at, downloaded };
  });
}
