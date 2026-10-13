import type { CloudState, WaltraDB } from "@/lib/db";
import { decodeData, encodeData, isPristine, readData, replaceData } from "./data";
import type { CloudTransport, CloudVersion } from "./drive";
import { versionToken } from "./drive";
import { GoogleError } from "./google";

export type CloudSyncResult =
  | { status: "ok" | "pending"; at: string; downloaded: boolean }
  | { status: "conflict"; local: string; versions: CloudVersion[] };
export interface Resolution { local: string; tokens: string[]; choice: string }

export class CloudOwnerError extends Error {
  constructor() { super("Los datos de este dispositivo están vinculados a otra cuenta de Google. Conectá la cuenta original para sincronizarlos."); }
}

/**
 * Copias completas y eliminaciones incluidas. Una edicion en ambos lados se
 * resuelve explicitamente; no se decide por el reloj del telefono.
 * Una sola copia reemplazable en Drive; el transporte controla la revision
 * antes de sobrescribir. No hay historial remoto acumulativo.
 */
export async function synchronize(
  db: WaltraDB, transport: CloudTransport, owner: string,
  active: () => boolean, resolution?: Resolution,
): Promise<CloudSyncResult> {
  const pending = (): CloudSyncResult => ({ status: "pending", at: new Date().toISOString(), downloaded: false });
  const state = await db.transaction("rw", db.cloudState, async () => {
    if (!active()) return null;
    const current = await db.cloudState.get("cloud");
    if (current && current.owner !== owner) throw new CloudOwnerError();
    const row: CloudState = current ?? { id: "cloud", owner, base: null };
    if (!current) await db.cloudState.put(row);
    return row;
  });
  if (!state) return pending();
  const local = await readData(db);
  let read: CloudVersion[];
  try { read = await transport.read(); }
  catch (err) { if (err instanceof GoogleError && [404, 412].includes(err.status ?? 0)) return pending(); throw err; }
  const versions = read.map((version) => ({
    ...version, payload: encodeData(decodeData(version.payload)),
  }));
  if (!active()) return pending();
  const conflict = (): CloudSyncResult => ({ status: "conflict", local, versions });
  const tokens = versions.map(versionToken).sort();
  const unique = new Set(versions.map((v) => v.payload));
  const remote = versions[0]?.payload ?? null;
  let selected: string;

  if (resolution) {
    // Una confirmacion vieja no autoriza pisar cambios que llegaron despues.
    if (resolution.local !== local || JSON.stringify([...resolution.tokens].sort()) !== JSON.stringify(tokens)) return conflict();
    const chosen = resolution.choice === "local" ? local : versions.find((v) => v.id === resolution.choice)?.payload;
    if (!chosen) return conflict();
    selected = chosen;
  } else {
    if (unique.size > 1) return conflict();
    if (remote === local) selected = local;
    else if (remote === null) {
      // La copia remota desaparecio. No se vuelve a subir nada sin preguntar.
      if (state.base !== null) return conflict();
      selected = local;
    } else if (local === state.base || (state.base === null && isPristine(local))) selected = remote;
    else if (remote === state.base) selected = local;
    else return conflict();
  }

  decodeData(selected); // Limite y forma comprobados antes de cualquier escritura.
  const needsUpload = selected !== remote || versions.length > 1;
  if (needsUpload) {
    if (!active()) return pending();
    try { await transport.write(selected, versions); }
    catch (err) { if (err instanceof GoogleError && [404, 412].includes(err.status ?? 0)) return pending(); throw err; }
    if (!active()) return pending();
  }

  const at = new Date().toISOString();
  return db.transaction("rw", db.tables, async () => {
    if (!active()) return pending();
    const currentState = await db.cloudState.get("cloud");
    if (currentState?.owner !== owner) throw new CloudOwnerError();
    // Otra pestana termino antes. Su baseline manda; releer en la proxima pasada.
    if (currentState.base !== state.base) return pending();
    const currentLocal = await readData(db);
    let downloaded = false;
    if (selected !== local) {
      if (currentLocal !== local) return pending();
      if (!isPristine(local)) {
        await db.cloudBackups.clear();
        await db.cloudBackups.add({ at, payload: local });
      }
      await replaceData(db, selected);
      downloaded = true;
    }
    await db.cloudState.put({ id: "cloud", owner, base: selected, syncedAt: at });
    return { status: selected === currentLocal || downloaded ? "ok" : "pending", at, downloaded };
  });
}
