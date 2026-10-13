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
});
