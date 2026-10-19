import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, WaltraDB, ensureSeeded } from "@/lib/db";
import type { Transaction } from "@/lib/types";
import { decodeData, encodeData, readData } from "../data";
import { MAX_RECOVERY, synchronize, unlinkCloud, type CloudSyncResult, type OptionKind } from "../sync";
import { GoogleError } from "../google";
import { MAX_PAYLOAD_BYTES } from "../data";
import { versionToken, type CloudTransport, type CloudVersion } from "../drive";

let db: WaltraDB;
const owner = "google-user-a";
const tx = (amount: number): Transaction => ({ id: "deposit", accountId: "cocos", type: "deposit",
  date: "2026-10-12", amount, currency: "USD", createdAt: "2026-10-12", updatedAt: "2026-10-12" });
const version = (payload: string, id = "remote"): CloudVersion => ({ id, etag: '"rev-1"', payload, at: "2026-10-12T15:00:00Z" });

function transport(versions: CloudVersion[] = []): CloudTransport & { read: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> } {
  return {
    read: vi.fn(async () => versions),
    write: vi.fn(async (payload: string) => version(payload, "uploaded")),
  };
}

/** Resuelve un conflicto eligiendo la opcion de ese tipo, como lo haria la pantalla. */
async function choose(result: CloudSyncResult, kind: OptionKind, cloud: CloudTransport) {
  if (result.status !== "conflict") throw new Error(`Se esperaba un conflicto y llego ${result.status}`);
  const option = result.options.find((o) => o.kind === kind);
  if (!option) throw new Error(`No se ofrecio ${kind}: ${result.options.map((o) => o.kind).join(", ")}`);
  return synchronize(db, cloud, owner, () => true, { local: result.local, tokens: result.versions.map(versionToken), choice: option.id });
}
const txs = (...entries: [string, number][]): Transaction[] => entries.map(([id, amount]) => ({ ...tx(amount), id }));

/** Un Drive con memoria: lo que se sube es lo que se lee despues. */
function memoryDrive(initial?: string) {
  let current: CloudVersion | null = initial ? version(initial, "archivo") : null;
  let revision = 1;
  const store = (payload: string, chain: string[] = []) => {
    current = { id: "archivo", etag: `"rev-${++revision}"`, payload, at: "2026-10-12T16:00:00Z", chain };
    return current;
  };
  return {
    read: vi.fn(async () => (current ? [current] : [])),
    write: vi.fn(async (payload: string, _expected?: CloudVersion[], chain?: string[]) => store(payload, chain)),
    store,
    /** Otro telefono baja la copia, le agrega un movimiento y la sube. */
    another(id: string, amount: number) {
      if (!current) throw new Error("No hay copia");
      const data = decodeData(current.payload);
      data.transactions = [...data.transactions, ...txs([id, amount])];
      return store(encodeData(data), [...(current.chain ?? []), `otro-${id}`]);
    },
    ids: () => (current ? decodeData(current.payload).transactions.map((t) => t.id).sort() : []),
  };
}

/**
 * Prepara el caso de la revision: este telefono agrego "x", otro agrego "c" y
 * lo subio. Sincronizar combina las dos cosas y sube.
 */
async function concurrentAdd() {
  await db.transactions.bulkPut(txs(["a", 1]));
  const base = await readData(db);
  await db.cloudState.put({ id: "cloud", owner, base });
  const remote = decodeData(base); remote.transactions = txs(["a", 1], ["c", 3]);
  await db.transactions.bulkPut(txs(["x", 500]));
  return memoryDrive(encodeData(remote));
}
const amounts = async () => (await db.transactions.toArray()).map((t) => `${t.id}:${t.amount}`).sort();

beforeEach(async () => {
  await new WaltraDB().delete(); db = new WaltraDB(); await db.open(); await ensureSeeded(db);
});
afterEach(() => db.close());

describe("sincronizacion de la cartera persistida", () => {
  it("sube datos sin credenciales y propaga eliminaciones hechas sin conexion", async () => {
    await db.transactions.put(tx(100));
    await db.settings.put({ ...DEFAULT_SETTINGS, apiKey: "private-anthropic", geminiKey: "private-gemini", accessKey: "private-server", lastQuoteSync: "local-time" });
    const cloud = transport();
    await synchronize(db, cloud, owner, () => true);
    const uploaded = cloud.write.mock.calls[0][0] as string;
    expect(JSON.parse(uploaded).transactions[0].amount).toBe(100);
    expect(uploaded).not.toMatch(/private-|apiKey|geminiKey|accessKey|lastQuoteSync/);
    cloud.read.mockResolvedValue([version(uploaded)]);
    await db.transactions.delete("deposit");
    await synchronize(db, cloud, owner, () => true);
    expect(JSON.parse(cloud.write.mock.calls[1][0]).transactions).toEqual([]);
    expect((await db.settings.get("settings"))?.apiKey).toBe("private-anthropic");
  });

  it("descarga en un dispositivo nuevo y conserva las claves de ese dispositivo", async () => {
    const data = decodeData(await readData(db));
    data.transactions = [tx(300)]; data.settings.goals = "Mi casa";
    await db.settings.update("settings", { apiKey: "local-secret" });
    const cloud = transport([version(encodeData(data))]);
    expect((await synchronize(db, cloud, owner, () => true)).status).toBe("ok");
    expect(await db.transactions.get("deposit")).toMatchObject({ amount: 300 });
    expect(await db.settings.get("settings")).toMatchObject({ goals: "Mi casa", apiKey: "local-secret" });
    expect(cloud.write).not.toHaveBeenCalled();
  });

  it("pausa cambios simultaneos y conserva una copia antes de elegir Drive", async () => {
    await db.transactions.put(tx(100));
    const base = await readData(db);
    await db.cloudState.put({ id: "cloud", owner, base });
    await db.transactions.put(tx(200));
    const remote = decodeData(base); remote.transactions = [tx(400)];
    const cloud = transport([version(encodeData(remote))]);
    const result = await synchronize(db, cloud, owner, () => true);
    expect(result.status).toBe("conflict");
    expect((await db.transactions.get("deposit"))?.amount).toBe(200);
    expect(cloud.write).not.toHaveBeenCalled();
    if (result.status !== "conflict") throw new Error("Se esperaba un conflicto");
    expect(result).toMatchObject({ kind: "both", clashes: 1 });
    await choose(result, "drive-wins", cloud);
    expect((await db.transactions.get("deposit"))?.amount).toBe(400);
    const saved = await db.cloudBackups.toArray();
    expect(saved).toHaveLength(1);
    expect(saved[0].origin).toBe("device");
    expect(JSON.parse(saved[0].payload).transactions[0].amount).toBe(200);
  });

  it("resuelve copias iniciales concurrentes sobrescribiendo una y consolidando las restantes", async () => {
    await db.transactions.put(tx(100));
    const local = await readData(db);
    const other = decodeData(local); other.transactions = [tx(600)];
    const cloud = transport([version(local, "device-a"), version(encodeData(other), "device-b")]);
    const result = await synchronize(db, cloud, owner, () => true);
    expect(result).toMatchObject({ status: "conflict", kind: "copies" });
    await choose(result, "device", cloud);
    expect(cloud.write.mock.calls[0][1]).toEqual([version(local, "device-a"), version(encodeData(other), "device-b")]);
    expect(JSON.parse(cloud.write.mock.calls[0][0]).transactions[0].amount).toBe(100);
  });

  it("no reemplaza una edicion local que se hizo durante la descarga", async () => {
    const base = await readData(db);
    await db.cloudState.put({ id: "cloud", owner, base });
    const remote = decodeData(base); remote.transactions = [tx(400)];
    const cloud = transport();
    cloud.read.mockImplementation(async () => { await db.transactions.put(tx(900)); return [version(encodeData(remote))]; });
    expect((await synchronize(db, cloud, owner, () => true)).status).toBe("pending");
    expect((await db.transactions.get("deposit"))?.amount).toBe(900);
    expect((await db.cloudState.get("cloud"))?.base).toBe(base);
  });

  it("deja pendientes las ediciones hechas mientras se subia otra copia", async () => {
    await db.transactions.put(tx(100));
    const cloud = transport();
    cloud.write.mockImplementation(async (payload: string) => { await db.transactions.put(tx(800)); return version(payload); });
    expect((await synchronize(db, cloud, owner, () => true)).status).toBe("pending");
    expect((await db.transactions.get("deposit"))?.amount).toBe(800);
    expect(JSON.parse((await db.cloudState.get("cloud"))!.base!).transactions[0].amount).toBe(100);
  });

  it("ignora respuestas de Drive despues de desconectar la cuenta", async () => {
    let active = true;
    const remote = decodeData(await readData(db)); remote.transactions = [tx(400)];
    const cloud = transport();
    cloud.read.mockImplementation(async () => { active = false; return [version(encodeData(remote))]; });
    await synchronize(db, cloud, owner, () => active);
    expect(await db.transactions.count()).toBe(0);
    expect((await db.cloudState.get("cloud"))?.base).toBeNull();
    expect(cloud.write).not.toHaveBeenCalled();
  });

  it("bloquea otra cuenta antes de leer o publicar datos en su Drive", async () => {
    await db.transactions.put(tx(250));
    await db.cloudState.put({ id: "cloud", owner, base: null });
    const cloud = transport();
    await expect(synchronize(db, cloud, "different-user", () => true)).rejects.toThrow(/otra cuenta/);
    expect(cloud.read).not.toHaveBeenCalled(); expect(cloud.write).not.toHaveBeenCalled();
    expect((await db.transactions.get("deposit"))?.amount).toBe(250);
  });

  it("conserva la cartera ante errores de red y no reconoce una subida fallida", async () => {
    await db.transactions.put(tx(250));
    const cloud = transport(); cloud.write.mockRejectedValue(new Error("offline"));
    await expect(synchronize(db, cloud, owner, () => true)).rejects.toThrow("offline");
    expect((await db.transactions.get("deposit"))?.amount).toBe(250);
    expect((await db.cloudState.get("cloud"))?.base).toBeNull();
  });

  it("no recrea automaticamente una copia eliminada del Drive", async () => {
    await db.transactions.put(tx(250));
    await db.cloudState.put({ id: "cloud", owner, base: await readData(db) });
    const cloud = transport();
    expect((await synchronize(db, cloud, owner, () => true)).status).toBe("conflict");
    expect(cloud.write).not.toHaveBeenCalled();
  });

  it("exige volver a elegir si la copia remota cambio despues de mostrar el conflicto", async () => {
    await db.transactions.put(tx(250));
    const local = await readData(db);
    const remote = decodeData(local); remote.transactions = [tx(300)];
    const cloud = transport([version(encodeData(remote), "new-head")]);
    expect((await synchronize(db, cloud, owner, () => true, { local, tokens: [JSON.stringify(["old-head", '"rev-1"'])], choice: "local" })).status).toBe("conflict");
    expect(cloud.write).not.toHaveBeenCalled();
  });

  it("rechaza datos corruptos de Drive sin modificar la cartera", async () => {
    await db.transactions.put(tx(250));
    const cloud = transport([version('{"app":"waltra","version":1,"transactions":[{"amount":"NaN"}]}')]);
    await expect(synchronize(db, cloud, owner, () => true)).rejects.toThrow();
    expect((await db.transactions.get("deposit"))?.amount).toBe(250);
    expect(cloud.write).not.toHaveBeenCalled();
  });

  it("no aplica una decision vieja cuando cambia el contenido del mismo archivo", async () => {
    await db.transactions.put(tx(250));
    const local = await readData(db);
    const remote = decodeData(local); remote.transactions = [tx(800)];
    const cloud = transport([{ ...version(encodeData(remote)), etag: '"rev-2"' }]);
    const result = await synchronize(db, cloud, owner, () => true, {
      local, tokens: [JSON.stringify(["remote", '"rev-1"'])], choice: "local",
    });
    expect(result.status).toBe("conflict");
    expect(cloud.write).not.toHaveBeenCalled();
    expect((await db.transactions.get("deposit"))?.amount).toBe(250);
  });

  it("no reconoce como subida una escritura rechazada por una carrera", async () => {
    await db.transactions.put(tx(250));
    const cloud = transport();
    cloud.write.mockRejectedValue(new GoogleError("changed", 412));
    expect((await synchronize(db, cloud, owner, () => true)).status).toBe("pending");
    expect((await db.cloudState.get("cloud"))?.base).toBeNull();
    expect((await db.transactions.get("deposit"))?.amount).toBe(250);
  });

  it("una descarga que no pisa nada propio no deja copias que roten las utiles", async () => {
    await db.transactions.put(tx(100));
    const base = await readData(db);
    await db.cloudState.put({ id: "cloud", owner, base });
    for (const amount of [200, 300, 400, 500]) {
      const remote = decodeData(base); remote.transactions = [tx(amount)];
      await synchronize(db, transport([version(encodeData(remote))]), owner, () => true);
    }
    expect((await db.transactions.get("deposit"))?.amount).toBe(500);
    expect(await db.cloudBackups.count()).toBe(0);
  });

  it("guarda como mucho las ultimas copias de recuperacion, sin repetirlas", async () => {
    for (const amount of [200, 300, 400, 500, 600]) {
      await db.transactions.put(tx(100));
      const base = await readData(db);
      await db.cloudState.put({ id: "cloud", owner, base });
      await db.transactions.put(tx(amount));
      const remote = decodeData(base); remote.transactions = [tx(amount + 1)];
      const cloud = transport([version(encodeData(remote))]);
      await choose(await synchronize(db, cloud, owner, () => true), "drive-wins", cloud);
    }
    const saved = await db.cloudBackups.orderBy("id").toArray();
    expect(saved).toHaveLength(MAX_RECOVERY);
    expect(saved.map((s) => JSON.parse(s.payload).transactions[0].amount)).toEqual([400, 500, 600]);
  });

  it("rechaza una cartera local excesiva antes de consultar o publicar en Drive", async () => {
    await db.settings.update("settings", { goals: "é".repeat(MAX_PAYLOAD_BYTES / 2) });
    const cloud = transport();
    await expect(synchronize(db, cloud, owner, () => true)).rejects.toThrow(/5 MiB/);
    expect(cloud.read).not.toHaveBeenCalled();
    expect(cloud.write).not.toHaveBeenCalled();
    expect((await db.settings.get("settings"))?.goals.length).toBe(MAX_PAYLOAD_BYTES / 2);
  });

  it("combina movimientos cargados sin conexion en dos equipos, sin preguntar", async () => {
    await db.transactions.bulkPut(txs(["a", 100]));
    const base = await readData(db);
    await db.cloudState.put({ id: "cloud", owner, base });
    await db.transactions.bulkPut(txs(["b", 200]));
    const remote = decodeData(base); remote.transactions = txs(["a", 100], ["c", 300]);
    const cloud = transport([version(encodeData(remote))]);
    const result = await synchronize(db, cloud, owner, () => true);
    expect(result).toMatchObject({ status: "ok", downloaded: true });
    expect(await amounts()).toEqual(["a:100", "b:200", "c:300"]);
    expect(decodeData(cloud.write.mock.calls[0][0]).transactions.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(await db.cloudBackups.count()).toBe(0);
  });

  it("no sube una cartera vaciada sin preguntar, y si se confirma guarda antes la de Drive", async () => {
    await db.transactions.bulkPut(txs(["a", 1], ["b", 2], ["c", 3]));
    const base = await readData(db);
    await db.cloudState.put({ id: "cloud", owner, base });
    await db.transactions.clear();
    const cloud = transport([version(base)]);
    const result = await synchronize(db, cloud, owner, () => true);
    expect(result).toMatchObject({ status: "conflict", kind: "shrink" });
    expect(cloud.write).not.toHaveBeenCalled();
    cloud.write.mockImplementation(async (payload: string) => {
      // La copia de Drive ya esta a salvo cuando se la pisa.
      const saved = await db.cloudBackups.toArray();
      expect(saved.map((s) => s.origin)).toEqual(["drive"]);
      expect(JSON.parse(saved[0].payload).transactions).toHaveLength(3);
      return version(payload, "uploaded");
    });
    await choose(result, "apply", cloud);
    expect(decodeData(cloud.write.mock.calls[0][0]).transactions).toEqual([]);
  });

  it("tampoco baja sin preguntar una cartera que otro equipo vacio", async () => {
    await db.transactions.bulkPut(txs(["a", 1], ["b", 2], ["c", 3]));
    const base = await readData(db);
    await db.cloudState.put({ id: "cloud", owner, base });
    const vacia = decodeData(base); vacia.transactions = [];
    const cloud = transport([version(encodeData(vacia))]);
    const result = await synchronize(db, cloud, owner, () => true);
    expect(result).toMatchObject({ status: "conflict", kind: "shrink" });
    expect(await db.transactions.count()).toBe(3);
    await choose(result, "device", cloud);
    expect(decodeData(cloud.write.mock.calls[0][0]).transactions).toHaveLength(3);
    expect(await db.transactions.count()).toBe(3);
  });

  it("en la primera conexion con datos en los dos lados ofrece juntarlos", async () => {
    await db.transactions.bulkPut(txs(["a", 100]));
    const remote = decodeData(await readData(db)); remote.transactions = txs(["b", 200]);
    const cloud = transport([version(encodeData(remote))]);
    const result = await synchronize(db, cloud, owner, () => true);
    if (result.status !== "conflict") throw new Error("Se esperaba un conflicto");
    expect(result.kind).toBe("first");
    expect(result.options.map((o) => o.kind)).toEqual(["device", "drive", "join"]);
    await choose(result, "join", cloud);
    expect(await amounts()).toEqual(["a:100", "b:200"]);
    expect(decodeData(cloud.write.mock.calls[0][0]).transactions).toHaveLength(2);
  });

  it("al quedarse con este dispositivo guarda la version de Drive que pisa", async () => {
    await db.transactions.put(tx(100));
    const base = await readData(db);
    await db.cloudState.put({ id: "cloud", owner, base });
    await db.transactions.put(tx(200));
    const remote = decodeData(base); remote.transactions = [tx(400)];
    const cloud = transport([version(encodeData(remote))]);
    await choose(await synchronize(db, cloud, owner, () => true), "device-wins", cloud);
    expect(decodeData(cloud.write.mock.calls[0][0]).transactions[0].amount).toBe(200);
    const saved = await db.cloudBackups.toArray();
    expect(saved.map((s) => [s.origin, JSON.parse(s.payload).transactions[0].amount])).toEqual([["drive", 400]]);
  });

  it("dice con que cuenta quedo vinculada, y desvincular deja usar otra sin perder la cartera", async () => {
    await db.transactions.put(tx(250));
    await db.cloudState.put({ id: "cloud", owner, email: "a@example.com", base: null });
    const cloud = transport();
    await expect(synchronize(db, cloud, "otra-cuenta", () => true)).rejects.toThrow(/a@example\.com/);
    expect(cloud.read).not.toHaveBeenCalled();
    await unlinkCloud(db);
    expect((await synchronize(db, cloud, "otra-cuenta", () => true, undefined, "b@example.com")).status).toBe("ok");
    expect(decodeData(cloud.write.mock.calls[0][0]).transactions[0].amount).toBe(250);
    expect(await db.cloudState.get("cloud")).toMatchObject({ owner: "otra-cuenta", email: "b@example.com" });
    expect((await db.transactions.get("deposit"))?.amount).toBe(250);
  });

  it("aplicar un borrado hecho en otro equipo guarda antes los datos de este", async () => {
    await db.transactions.bulkPut(txs(["a", 1], ["b", 2], ["c", 3]));
    const base = await readData(db);
    await db.cloudState.put({ id: "cloud", owner, base });
    const vacia = decodeData(base); vacia.transactions = [];
    const cloud = transport([version(encodeData(vacia))]);
    await choose(await synchronize(db, cloud, owner, () => true), "apply", cloud);
    expect(await db.transactions.count()).toBe(0);
    const saved = await db.cloudBackups.toArray();
    expect(saved.map((s) => [s.origin, JSON.parse(s.payload).transactions.length])).toEqual([["device", 3]]);
  });

  it("le pasa a Drive la revision confirmada para no bajarla de nuevo", async () => {
    await db.transactions.put(tx(100));
    const cloud = transport();
    await synchronize(db, cloud, owner, () => true);
    const uploaded = cloud.write.mock.calls[0][0] as string;
    expect(await db.cloudState.get("cloud")).toMatchObject({ remote: { id: "uploaded", etag: '"rev-1"' } });
    cloud.read.mockResolvedValue([version(uploaded, "uploaded")]);
    expect((await synchronize(db, cloud, owner, () => true)).status).toBe("ok");
    expect(cloud.read.mock.calls[1][0]).toMatchObject({ id: "uploaded", etag: '"rev-1"', payload: uploaded });
    expect(cloud.write).toHaveBeenCalledTimes(1);
  });

  it("lo que se borra mientras sube una combinacion no vuelve en la pasada siguiente", async () => {
    const drive = await concurrentAdd();
    drive.write.mockImplementationOnce(async (payload: string) => {
      const saved = drive.store(payload);
      await db.transactions.delete("x"); // el usuario se arrepiente mientras sube
      return saved;
    });
    expect((await synchronize(db, drive, owner, () => true)).status).toBe("pending");
    expect((await synchronize(db, drive, owner, () => true)).status).toBe("ok");
    expect((await db.transactions.toArray()).map((t) => t.id).sort()).toEqual(["a", "c"]);
    expect(drive.ids()).toEqual(["a", "c"]);
  });

  it("y tampoco vuelve si antes de la pasada siguiente otro telefono subio algo", async () => {
    const drive = await concurrentAdd();
    drive.write.mockImplementationOnce(async (payload: string) => {
      const saved = drive.store(payload);
      await db.transactions.delete("x");
      return saved;
    });
    await synchronize(db, drive, owner, () => true);
    // El otro telefono baja lo combinado y agrega "d".
    drive.another("d", 4);
    expect((await synchronize(db, drive, owner, () => true)).status).toBe("ok");
    expect((await db.transactions.toArray()).map((t) => t.id).sort()).toEqual(["a", "c", "d"]);
  });

  it("si se pierde la respuesta de una subida que llego, lo borrado despues no vuelve", async () => {
    const drive = await concurrentAdd();
    drive.write.mockImplementationOnce(async (payload: string, _expected?: CloudVersion[], chain?: string[]) => {
      drive.store(payload, chain); // Drive la guardo, pero la respuesta no llega
      throw new Error("Failed to fetch");
    });
    await expect(synchronize(db, drive, owner, () => true)).rejects.toThrow("Failed to fetch");
    await db.transactions.delete("x");
    expect((await synchronize(db, drive, owner, () => true)).status).toBe("ok");
    expect((await db.transactions.toArray()).map((t) => t.id).sort()).toEqual(["a", "c"]);
    expect(drive.ids()).toEqual(["a", "c"]);
    expect((await db.cloudState.get("cloud"))?.sending).toBeUndefined();
  });

  it("desconectar a mitad de una subida deja anotado de donde salio lo que se subio", async () => {
    const drive = await concurrentAdd();
    let active = true;
    drive.write.mockImplementationOnce(async (payload: string) => {
      active = false;
      return drive.store(payload);
    });
    expect((await synchronize(db, drive, owner, () => active)).status).toBe("pending");
    // Sin conexion, se borra lo que se habia agregado; al volver no reaparece.
    await db.transactions.delete("x");
    expect((await synchronize(db, drive, owner, () => true)).status).toBe("ok");
    expect((await db.transactions.toArray()).map((t) => t.id).sort()).toEqual(["a", "c"]);
  });

  it("dos telefonos con la misma fila y otras marcas de tiempo no se la pasan para siempre", async () => {
    const other = new WaltraDB("waltra-otro-telefono");
    await other.delete(); await other.open(); await ensureSeeded(other);
    try {
      await db.transactions.put(tx(100));
      const drive = memoryDrive();
      await synchronize(db, drive, owner, () => true);
      await synchronize(other, drive, owner, () => true);
      // El otro guarda el mismo movimiento sin cambiarlo.
      await other.transactions.update("deposit", { updatedAt: "2026-10-13T00:00:00Z" });
      for (let round = 0; round < 3; round++) {
        await synchronize(db, drive, owner, () => true);
        await synchronize(other, drive, owner, () => true);
      }
      expect(drive.write.mock.calls.length).toBeLessThanOrEqual(2);
      const mine = await db.transactions.get("deposit");
      const theirs = await other.transactions.get("deposit");
      expect(mine?.updatedAt).toBe(theirs?.updatedAt);
    } finally {
      other.close(); await other.delete();
    }
  });

  it("no ofrece juntar si hay algo que choca", async () => {
    await db.transactions.bulkPut(txs(["a", 100]));
    const remote = decodeData(await readData(db)); remote.transactions = txs(["a", 200], ["b", 300]);
    const result = await synchronize(db, transport([version(encodeData(remote))]), owner, () => true);
    if (result.status !== "conflict") throw new Error("Se esperaba un conflicto");
    expect(result.options.map((o) => o.kind)).toEqual(["device", "drive"]);
  });

  it("un indice de referencia que cambio en otro telefono vuelve a bajar su serie", async () => {
    await db.transactions.put(tx(100));
    const base = await readData(db);
    await db.cloudState.put({ id: "cloud", owner, base });
    await db.priceSeries.bulkPut([
      { assetId: "__benchmark", currency: "USD", points: [{ date: "2026-10-01", close: 1 }], updatedAt: "2026-10-12" },
      { assetId: "otro", currency: "USD", points: [{ date: "2026-10-01", close: 2 }], updatedAt: "2026-10-12" },
    ]);
    const remote = decodeData(base); remote.settings.benchmark = "QQQ";
    await synchronize(db, transport([version(encodeData(remote))]), owner, () => true);
    expect(await db.priceSeries.get("__benchmark")).toBeUndefined();
    expect(await db.priceSeries.get("otro")).toBeDefined();
  });

  it("proveedor, modelo, tema y vibracion son de cada telefono", async () => {
    await db.settings.update("settings", { provider: "gemini", model: "gemini-x", theme: "mono", haptics: false });
    const cloud = transport();
    await synchronize(db, cloud, owner, () => true);
    expect(cloud.write.mock.calls[0][0]).not.toMatch(/"provider"|"model"|"theme"|"haptics"/);
    const remote = decodeData(cloud.write.mock.calls[0][0]); remote.settings.goals = "Otra meta";
    await synchronize(db, transport([version(encodeData(remote), "otra")]), owner, () => true);
    expect(await db.settings.get("settings")).toMatchObject({ goals: "Otra meta", provider: "gemini", theme: "mono", haptics: false });
  });

  it("si se pierde la respuesta y otro telefono sube encima, lo borrado tampoco vuelve", async () => {
    const drive = await concurrentAdd();
    drive.write.mockImplementationOnce(async (payload: string, _expected?: CloudVersion[], chain?: string[]) => {
      drive.store(payload, chain);
      throw new Error("Failed to fetch");
    });
    await expect(synchronize(db, drive, owner, () => true)).rejects.toThrow("Failed to fetch");
    drive.another("d", 4);
    await db.transactions.delete("x");
    expect((await synchronize(db, drive, owner, () => true)).status).toBe("ok");
    expect((await db.transactions.toArray()).map((t) => t.id).sort()).toEqual(["a", "c", "d"]);
    expect(drive.ids()).toEqual(["a", "c", "d"]);
  });

  it("una subida que se reconoce queda anotada aunque la pasada choque con otra", async () => {
    const drive = await concurrentAdd();
    drive.write.mockImplementationOnce(async (payload: string, _expected?: CloudVersion[], chain?: string[]) => {
      drive.store(payload, chain);
      throw new Error("Failed to fetch");
    });
    await expect(synchronize(db, drive, owner, () => true)).rejects.toThrow("Failed to fetch");
    await db.transactions.delete("x");
    // La pasada siguiente reconoce la subida, pero su propia subida choca: otro
    // telefono subio en el medio.
    drive.write.mockImplementationOnce(async () => {
      drive.another("d", 4);
      throw new GoogleError("changed", 412);
    });
    expect((await synchronize(db, drive, owner, () => true)).status).toBe("pending");
    expect((await synchronize(db, drive, owner, () => true)).status).toBe("ok");
    expect((await db.transactions.toArray()).map((t) => t.id).sort()).toEqual(["a", "c", "d"]);
  });

  it("una resolucion que descarta lo de este telefono guarda la copia aunque no se aplique en el momento", async () => {
    await db.transactions.put(tx(100));
    const base = await readData(db);
    await db.cloudState.put({ id: "cloud", owner, base });
    // Choca el deposito; "n" no choca, asi que quedarse con Drive igual sube.
    await db.transactions.bulkPut([tx(200), ...txs(["n", 7])]);
    const remote = decodeData(base); remote.transactions = [tx(400)];
    const drive = memoryDrive(encodeData(remote));
    const result = await synchronize(db, drive, owner, () => true);
    drive.write.mockImplementationOnce(async (payload: string, _expected?: CloudVersion[], chain?: string[]) => {
      const saved = drive.store(payload, chain);
      await db.transactions.bulkPut(txs(["z", 9])); // se carga algo mientras sube
      return saved;
    });
    expect((await choose(result, "drive-wins", drive)).status).toBe("pending");
    const saved = await db.cloudBackups.toArray();
    expect(saved.map((s) => [s.origin, JSON.parse(s.payload).transactions[0].amount])).toEqual([["device", 200]]);
  });

  it("quedarse con este telefono entero no hereda la cadena de la copia que reemplaza", async () => {
    await db.transactions.bulkPut(txs(["a", 100]));
    const remote = decodeData(await readData(db)); remote.transactions = txs(["b", 200]);
    const cloud = transport([{ ...version(encodeData(remote)), chain: ["pendiente-de-otro"] }]);
    await choose(await synchronize(db, cloud, owner, () => true), "device", cloud);
    const chain = cloud.write.mock.calls[0][2] as string[];
    expect(chain).toHaveLength(1);
    expect(chain).not.toContain("pendiente-de-otro");
  });

  it("combinar sigue la cadena de la copia de Drive de la que sale", async () => {
    await db.transactions.bulkPut(txs(["a", 1]));
    const base = await readData(db);
    await db.cloudState.put({ id: "cloud", owner, base });
    await db.transactions.bulkPut(txs(["b", 2]));
    const remote = decodeData(base); remote.transactions = txs(["a", 1], ["c", 3]);
    const cloud = transport([{ ...version(encodeData(remote)), chain: ["p1", "p2"] }]);
    await synchronize(db, cloud, owner, () => true);
    const chain = cloud.write.mock.calls[0][2] as string[];
    expect(chain.slice(0, 2)).toEqual(["p1", "p2"]);
    expect(chain).toHaveLength(3);
  });

  it("con varias copias, elegir una sigue la cadena de esa", async () => {
    await db.transactions.bulkPut(txs(["a", 100]));
    const one = decodeData(await readData(db)); one.transactions = txs(["b", 200]);
    const two = decodeData(await readData(db)); two.transactions = txs(["c", 300]);
    const cloud = transport([{ ...version(encodeData(one), "uno"), chain: ["de-uno"] }, { ...version(encodeData(two), "dos"), chain: ["de-dos"] }]);
    const result = await synchronize(db, cloud, owner, () => true);
    if (result.status !== "conflict") throw new Error("Se esperaba un conflicto");
    const dos = result.options.find((o) => o.id === "drive:dos")!;
    await synchronize(db, cloud, owner, () => true, { local: result.local, tokens: result.versions.map(versionToken), choice: dos.id });
    expect((cloud.write.mock.calls[0][2] as string[])[0]).toBe("de-dos");
  });

  it("una subida pendiente frente a una copia reemplazada entera pregunta en vez de borrar", async () => {
    // La primera subida de este telefono choca con la de otro; el otro elige
    // sus propios datos enteros, y esa copia ya no sale de la de aca.
    await db.transactions.bulkPut(txs(["a1", 1], ["a2", 2], ["a3", 3]));
    const drive = memoryDrive();
    drive.write.mockImplementationOnce(async (payload: string, _expected?: CloudVersion[], chain?: string[]) => {
      drive.store(payload, chain);
      throw new GoogleError("changed", 412);
    });
    expect((await synchronize(db, drive, owner, () => true)).status).toBe("pending");
    const deOtro = decodeData(await readData(db)); deOtro.transactions = txs(["b1", 1], ["b2", 2], ["b3", 3]);
    drive.store(encodeData(deOtro), ["del-otro"]);
    expect((await synchronize(db, drive, owner, () => true))).toMatchObject({ status: "conflict", kind: "first" });
    expect((await db.transactions.toArray()).map((t) => t.id).sort()).toEqual(["a1", "a2", "a3"]);
  });

  it("al consolidar copias identicas junta sus cadenas", async () => {
    await db.transactions.bulkPut(txs(["a", 100]));
    const local = await readData(db);
    const cloud = transport([{ ...version(local, "uno"), chain: ["de-uno"] }, { ...version(local, "dos"), chain: ["de-dos"] }]);
    expect((await synchronize(db, cloud, owner, () => true)).status).toBe("ok");
    const chain = cloud.write.mock.calls[0][2] as string[];
    expect(chain.slice(0, 2)).toEqual(["de-uno", "de-dos"]);
    expect(chain).toHaveLength(3);
  });

  it("una copia de Drive vacia, de un equipo que se conecto antes de cargar nada, se reemplaza sin preguntar", async () => {
    const vacia = await readData(db);
    await db.transactions.bulkPut(txs(["a", 100]));
    const cloud = transport([{ ...version(vacia), chain: ["del-vacio"] }]);
    expect((await synchronize(db, cloud, owner, () => true)).status).toBe("ok");
    expect(decodeData(cloud.write.mock.calls[0][0]).transactions).toHaveLength(1);
    // Lo subido no sale de esa copia: arranca su propia cadena.
    expect(cloud.write.mock.calls[0][2]).not.toContain("del-vacio");
  });
});
