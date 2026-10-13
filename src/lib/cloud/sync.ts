import type { CloudBackup, CloudState, WaltraDB } from "@/lib/db";
import { decodeData, encodeData, isPristine, readData, replaceData } from "./data";
import type { CloudTransport, CloudVersion } from "./drive";
import { versionToken } from "./drive";
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

type Plan = { selected: string } | Omit<CloudConflict, "status" | "local" | "versions">;

function option(kind: OptionKind, payload: string, version?: CloudVersion): ConflictOption {
  return {
    id: version ? `${kind}:${version.id}` : kind, kind, payload,
    transactions: decodeData(payload).transactions.length,
    ...(version ? { at: version.at } : {}),
  };
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
    return { kind: "copies", clashes: 0, options: [option("device", local), ...versions.map((v) => option("drive", v.payload, v))] };
  }
  if (remote === local) return { selected: local };
  if (remote === null) {
    // La copia remota desaparecio. No se vuelve a subir nada sin preguntar.
    if (base !== null) return { kind: "missing", clashes: 0, options: [option("device", local)] };
    return { selected: local };
  }
  if (base === null) {
    if (isPristine(local)) return { selected: remote };
    // Juntar sin una base comun puede repetir lo que se cargo en los dos
    // lados por separado: se ofrece, pero no se hace solo.
    const joined = mergeData(null, decodeData(local), decodeData(remote), "local");
    return { kind: "first", clashes: 0, options: [
      option("device", local), option("drive", remote, head),
      ...(joined.consistent ? [option("join", encodeData(joined.data))] : []),
    ] };
  }
  const [b, l, r] = [decodeData(base), decodeData(local), decodeData(remote)];
  const merged = mergeData(b, l, r);
  if (merged.clashes > 0 || !merged.consistent) {
    const wins = (prefer: "local" | "remote") => {
      const result = mergeData(b, l, r, prefer);
      // Si ni asi cierra (un movimiento nuevo de un activo que el otro lado
      // borro), queda elegir un lado entero.
      if (!result.consistent) return prefer === "local" ? option("device", local) : option("drive", remote, head);
      return option(prefer === "local" ? "device-wins" : "drive-wins", encodeData(result.data), prefer === "local" ? undefined : head);
    };
    return { kind: "both", clashes: merged.clashes, options: [wins("local"), wins("remote")] };
  }
  if (shrinks(l, merged.data) || shrinks(r, merged.data)) {
    const keep = l.transactions.length >= r.transactions.length ? option("device", local) : option("drive", remote, head);
    return { kind: "shrink", clashes: 0, options: [option("apply", encodeData(merged.data)), keep] };
  }
  return { selected: encodeData(merged.data) };
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
  const local = await readData(db);
  let read: CloudVersion[];
  const known = state.base !== null && state.remote ? { ...state.remote, payload: state.base, at: "" } : undefined;
  try { read = await transport.read(known); }
  catch (err) { if (err instanceof GoogleError && [404, 412].includes(err.status ?? 0)) return pending(); throw err; }
  const versions = read.map((version) => ({
    ...version, payload: encodeData(decodeData(version.payload)),
  }));
  if (!active()) return pending();
  const tokens = versions.map(versionToken).sort();
  const decision = plan(state.base, local, versions);
  let selected: string;

  if ("selected" in decision) {
    // Tambien con una resolucion en mano: si lo que llego despues ya se puede
    // combinar solo, no hay nada que preguntar.
    selected = decision.selected;
  } else {
    const conflict: CloudConflict = { status: "conflict", local, versions, ...decision };
    // Una confirmacion vieja no autoriza pisar cambios que llegaron despues.
    if (!resolution || resolution.local !== local || JSON.stringify([...resolution.tokens].sort()) !== JSON.stringify(tokens)) return conflict;
    const chosen = decision.options.find((o) => o.id === resolution.choice);
    if (!chosen) return conflict;
    selected = chosen.payload;
  }

  const result = decodeData(selected); // Limite y forma comprobados antes de cualquier escritura.
  const base = state.base === null ? null : decodeData(state.base);
  // Un lado pierde algo si el resultado deja afuera lo que ese lado cambio, o
  // si se confirmo un borrado grande: esos datos no quedan en ningun otro lado.
  const loses = (side: string) => {
    const data = decodeData(side);
    return discards(base, data, result) || shrinks(data, result);
  };
  const remote = versions[0]?.payload ?? null;
  const at = new Date().toISOString();
  let confirmed: CloudVersion | undefined = versions[0];
  if (selected !== remote || versions.length > 1) {
    // Lo que la subida pisa se guarda antes de subir: Drive no conserva la
    // version anterior.
    const lost = versions.filter((v) => v.payload !== selected && loses(v.payload));
    if (lost.length) await saveRecovery(db, lost.map((v) => ({ payload: v.payload, origin: "drive" as const })), at);
    if (!active()) return pending();
    try { confirmed = await transport.write(selected, versions); }
    catch (err) { if (err instanceof GoogleError && [404, 412].includes(err.status ?? 0)) return pending(); throw err; }
    if (!active()) return pending();
  }

  return db.transaction("rw", db.tables, async () => {
    if (!active()) return pending();
    const currentState = await db.cloudState.get("cloud");
    // Se desvinculo o se cambio de cuenta mientras se subia: no se confirma nada.
    if (currentState?.owner !== owner) return pending();
    // Otra pestana termino antes. Su baseline manda; releer en la proxima pasada.
    if (currentState.base !== state.base) return pending();
    const currentLocal = await readData(db);
    let downloaded = false;
    if (selected !== local) {
      if (currentLocal !== local) return pending();
      if (!isPristine(local) && loses(local)) {
        await saveRecovery(db, [{ payload: local, origin: "device" }], at);
      }
      await replaceData(db, selected);
      downloaded = true;
    }
    await db.cloudState.put({ ...currentState, base: selected, syncedAt: at,
      remote: confirmed && { id: confirmed.id, etag: confirmed.etag } });
    return { status: selected === currentLocal || downloaded ? "ok" : "pending", at, downloaded };
  });
}
