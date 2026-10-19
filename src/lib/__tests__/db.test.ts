import "fake-indexeddb/auto";
import Dexie from "dexie";
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
  it("migra una cartera anterior sin borrar movimientos al agregar sincronizacion", async () => {
    db.close();
    await new WaltraDB().delete();
    const previous = new Dexie("waltra");
    previous.version(1).stores({
      accounts: "id, broker, name", assets: "id, symbol, kind, source",
      transactions: "id, date, type, accountId, assetId", priceSeries: "assetId",
      quotes: "assetId", fx: "date", settings: "id", insights: "id, createdAt",
    });
    await previous.open();
    await previous.table("transactions").put(tx({ amount: 750 }));
    previous.close();
    db = new WaltraDB();
    await db.open();
    expect((await db.transactions.get("t1"))?.amount).toBe(750);
    expect(await db.cloudState.count()).toBe(0);
    expect(await db.cloudBackups.count()).toBe(0);
  });
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
    const report = {
      id: "informe-1", createdAt: "2026-01-15T00:00:00.000Z", model: "externo",
      marketBrief: "Resumen guardado", signals: [], sources: [], portfolioDigest: "Cartera",
      profileRead: { summary: "Perfil", observations: [], risks: [], suggestions: [] },
    };
    await db.insights.put(report);
    const backup = await exportBackup(db);
    expect(backup.app).toBe("waltra");
    expect(backup.transactions).toHaveLength(2);

    await db.transactions.clear();
    await db.insights.clear();
    const summary = await importBackup(db, backup, "replace");
    expect(summary.transactions).toBe(2);
    expect(await db.transactions.count()).toBe(2);
    expect(await db.insights.get(report.id)).toEqual(report);
  });

  it("no incluye ninguna credencial en el archivo", async () => {
    // El backup termina en Drive, en un mail o en un chat. Cualquier clave
    // que viaje ahi adentro ya no es del telefono.
    await ensureSeeded(db);
    await db.settings.put({
      id: "settings", baseCurrency: "USD", riskProfile: "moderado",
      horizonYears: 5, goals: "", accessKey: "una-clave-secreta",
      apiKey: "la-clave-de-anthropic-del-usuario",
      geminiKey: "la-clave-de-gemini-del-usuario",
    });
    const backup = await exportBackup(db);
    expect(backup.settings.accessKey).toBeUndefined();
    expect(backup.settings.apiKey).toBeUndefined();
    expect(backup.settings.geminiKey).toBeUndefined();
    const texto = JSON.stringify(backup);
    expect(texto).not.toContain("una-clave-secreta");
    expect(texto).not.toContain("la-clave-de-anthropic-del-usuario");
    expect(texto).not.toContain("la-clave-de-gemini-del-usuario");
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

  it("las claves locales no se pisan al importar una copia de recuperacion", async () => {
    await ensureSeeded(db);
    await db.settings.put({
      id: "settings", baseCurrency: "USD", riskProfile: "moderado",
      horizonYears: 5, goals: "", accessKey: "local",
      apiKey: "local-anthropic", geminiKey: "local-gemini",
    });
    const backup = await exportBackup(db);
    backup.settings.apiKey = "otra-clave";
    backup.settings.geminiKey = "otra-clave-gemini";
    await importBackup(db, backup, "merge");
    expect(await db.settings.get("settings")).toMatchObject({
      accessKey: "local", apiKey: "local-anthropic", geminiKey: "local-gemini",
    });
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
    await db.cloudBackups.add({ at: "2026-10-12", payload: "copia anterior" });
    await wipeAll(db);
    expect(await db.transactions.count()).toBe(0);
    expect(await db.accounts.count()).toBe(0);
    expect(await db.assets.count()).toBe(0);
    expect(await db.settings.count()).toBe(0);
    expect(await db.cloudBackups.count()).toBe(0);
  });
});
