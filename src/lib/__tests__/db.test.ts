import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { WaltraDB, ensureSeeded, exportBackup, importBackup, parseBackup, wipeAll } from "@/lib/db";
import { clearDemoData, hasDemoData, loadDemoData } from "@/lib/demo";
import type { Transaction } from "@/lib/types";

let db: WaltraDB;

beforeEach(async () => {
  // Base limpia en cada test: se borra la anterior y se abre de cero.
  await new WaltraDB().delete();
  db = new WaltraDB();
  await db.open();
});

const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: over.id ?? "t1",
  date: "2026-01-15",
  type: "deposit",
  accountId: "cocos",
  amount: 100,
  currency: "USD",
  createdAt: "2026-01-15T00:00:00.000Z",
  updatedAt: "2026-01-15T00:00:00.000Z",
  ...over,
});

describe("ensureSeeded", () => {
  it("crea cuentas y ajustes la primera vez", async () => {
    await ensureSeeded(db);
    expect(await db.accounts.count()).toBe(2);
    expect((await db.settings.get("settings"))?.baseCurrency).toBe("USD");
  });

  it("no pisa lo que ya existe", async () => {
    await ensureSeeded(db);
    await db.accounts.clear();
    await db.accounts.put({
      id: "mia", name: "Mi cuenta", broker: "other", currency: "ARS", createdAt: "",
    });
    await ensureSeeded(db);
    expect(await db.accounts.count()).toBe(1);
  });
});

describe("backup", () => {
  it("exporta e importa sin perder nada", async () => {
    await ensureSeeded(db);
    await db.transactions.bulkPut([tx({ id: "t1" }), tx({ id: "t2", amount: 250 })]);
    const backup = await exportBackup(db);
    expect(backup.app).toBe("waltra");
    expect(backup.transactions).toHaveLength(2);

    await db.transactions.clear();
    const summary = await importBackup(db, backup, "replace");
    expect(summary.transactions).toBe(2);
    expect(await db.transactions.count()).toBe(2);
  });

  it("no incluye la clave de acceso en el archivo", async () => {
    await ensureSeeded(db);
    await db.settings.put({
      id: "settings", baseCurrency: "USD", riskProfile: "moderado",
      horizonYears: 5, goals: "", accessKey: "una-clave-secreta",
    });
    const backup = await exportBackup(db);
    expect(backup.settings.accessKey).toBeUndefined();
    expect(JSON.stringify(backup)).not.toContain("una-clave-secreta");
  });

  it("importar en modo combinar conserva lo que ya estaba", async () => {
    await ensureSeeded(db);
    await db.transactions.put(tx({ id: "viejo" }));
    const backup = await exportBackup(db);
    backup.transactions = [tx({ id: "nuevo", amount: 500 })];
    await importBackup(db, backup, "merge");
    const ids = (await db.transactions.toArray()).map((t) => t.id).sort();
    expect(ids).toEqual(["nuevo", "viejo"]);
  });

  it("importar en modo reemplazar borra lo anterior", async () => {
    await ensureSeeded(db);
    await db.transactions.put(tx({ id: "viejo" }));
    const backup = await exportBackup(db);
    backup.transactions = [tx({ id: "nuevo" })];
    await importBackup(db, backup, "replace");
    const ids = (await db.transactions.toArray()).map((t) => t.id);
    expect(ids).toEqual(["nuevo"]);
  });

  it("la clave local no se pisa al importar", async () => {
    await ensureSeeded(db);
    await db.settings.put({
      id: "settings", baseCurrency: "USD", riskProfile: "moderado",
      horizonYears: 5, goals: "", accessKey: "local",
    });
    const backup = await exportBackup(db);
    await importBackup(db, backup, "merge");
    expect((await db.settings.get("settings"))?.accessKey).toBe("local");
  });
});

describe("parseBackup", () => {
  it("rechaza texto que no es JSON", () => {
    expect(() => parseBackup("{no json")).toThrow(/JSON/);
  });

  it("rechaza un JSON de otra app", () => {
    expect(() => parseBackup('{"app":"otra"}')).toThrow(/Waltra/);
  });

  it("rechaza un backup incompleto", () => {
    expect(() => parseBackup('{"app":"waltra","version":1}')).toThrow(/incompleto/);
  });

  it("acepta un backup valido", () => {
    const file = parseBackup(
      JSON.stringify({ app: "waltra", version: 1, accounts: [], assets: [], transactions: [] }),
    );
    expect(file.app).toBe("waltra");
  });
});

describe("datos de ejemplo", () => {
  it("se cargan y se borran sin tocar lo propio", async () => {
    await ensureSeeded(db);
    await db.transactions.put(tx({ id: "mio-1" }));
    await loadDemoData(db);

    const conEjemplo = await db.transactions.toArray();
    expect(conEjemplo.length).toBeGreaterThan(10);
    expect(hasDemoData(conEjemplo.map((t) => t.id))).toBe(true);

    await clearDemoData(db);
    const despues = await db.transactions.toArray();
    expect(despues.map((t) => t.id)).toEqual(["mio-1"]);
    expect(await db.assets.count()).toBe(0);
  });

  it("los movimientos de ejemplo son consistentes", async () => {
    await ensureSeeded(db);
    await loadDemoData(db);
    const txs = await db.transactions.toArray();
    const assets = await db.assets.toArray();
    for (const t of txs) {
      expect(t.amount).toBeGreaterThan(0);
      if (t.type === "buy" || t.type === "sell") {
        expect(t.quantity).toBeGreaterThan(0);
        expect(t.price).toBeGreaterThan(0);
        // El monto tiene que cerrar con cantidad por precio.
        expect(t.quantity! * t.price!).toBeCloseTo(t.amount, 1);
        expect(assets.some((a) => a.id === t.assetId)).toBe(true);
      }
    }
  });
});

describe("wipeAll", () => {
  it("deja la base vacia", async () => {
    await ensureSeeded(db);
    await loadDemoData(db);
    await wipeAll(db);
    expect(await db.transactions.count()).toBe(0);
    expect(await db.accounts.count()).toBe(0);
    expect(await db.assets.count()).toBe(0);
    expect(await db.settings.count()).toBe(0);
  });
});
