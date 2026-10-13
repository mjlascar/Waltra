import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/db";
import type { AlertRules } from "@/lib/alerts/plan";
import type { Schedule } from "@/lib/insights/schedule";
import type { Account, Asset, InsightReport, InsightSignal, InsightSource, Settings, Transaction } from "@/lib/types";
import { CloudFormatError, LOCAL_SETTINGS, decodeData, encodeData, type CloudData } from "../data";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Mismas claves y mismos tipos: un campo opcional que falta pasa la asignabilidad sola. */
type Exact<A, B> = Same<keyof A, keyof B> extends true ? Same<A, B> : false;
type Synced = CloudData["settings"];
type Insight = CloudData["insights"][number];
type Local = (typeof LOCAL_SETTINGS)[number];

// Si un tipo gana un campo y el esquema de la nube no, esto deja de compilar.
// Sin el campo en el esquema, el telefono que lo tiene lo descartaria al subir.
const parity: [
  Exact<CloudData["accounts"][number], Account>,
  Exact<CloudData["assets"][number], Asset>,
  Exact<CloudData["transactions"][number], Transaction>,
  Exact<Insight, InsightReport>,
  Exact<Insight["signals"][number], InsightSignal>,
  Exact<Insight["sources"][number], InsightSource>,
  Exact<Insight["profileRead"], InsightReport["profileRead"]>,
  Exact<NonNullable<Synced["alerts"]>, AlertRules>,
  Exact<NonNullable<Synced["schedules"]>[number], Schedule>,
  // Cada ajuste eligio lado: viaja, o es de este dispositivo.
  Exact<Synced, Omit<Settings, Local>>,
  Same<Extract<keyof Synced, Local>, never>,
] = [true, true, true, true, true, true, true, true, true, true, true];

const empty = (): CloudData => ({
  app: "waltra", version: 1, accounts: [], assets: [], transactions: [], insights: [],
  settings: { ...DEFAULT_SETTINGS },
});
const tx: Transaction = {
  id: "t1", date: "2026-10-12", type: "deposit", accountId: "cocos", amount: 100, currency: "USD",
  createdAt: "2026-10-12", updatedAt: "2026-10-12",
};

describe("formato de la copia en Drive", () => {
  it("el esquema cubre todos los campos de los tipos sincronizados", () => {
    expect(parity.every(Boolean)).toBe(true);
  });

  it("al subir descarta credenciales y campos viejos que ningun tipo declara", () => {
    const payload = encodeData({
      ...empty(),
      settings: { ...DEFAULT_SETTINGS, apiKey: "sk-privada", lastQuoteSync: "hoy" },
      transactions: [{ ...tx, legado: "de una version vieja" }],
    });
    expect(payload).not.toMatch(/sk-privada|apiKey|lastQuoteSync|legado/);
    expect(decodeData(payload).transactions[0].amount).toBe(100);
  });

  it("al bajar rechaza un campo desconocido en vez de descartarlo", () => {
    // Descartarlo y despues subir le borraria el campo al telefono con la
    // version nueva, que si lo entiende.
    const nueva = JSON.parse(encodeData({ ...empty(), transactions: [tx] }));
    nueva.transactions[0].campoNuevo = 1;
    expect(() => decodeData(JSON.stringify(nueva))).toThrow(CloudFormatError);
    expect(() => decodeData(JSON.stringify(nueva))).toThrow(/versión más nueva/);
  });

  it("un tipo de movimiento que esta version no conoce tambien pide actualizar", () => {
    const nueva = JSON.parse(encodeData({ ...empty(), transactions: [tx] }));
    nueva.transactions[0].type = "staking";
    expect(() => decodeData(JSON.stringify(nueva))).toThrow(/Actualizá la app/);
  });

  it("explica un archivo roto sin confundirlo con una version nueva", () => {
    expect(() => decodeData("{no es json")).toThrow(/dañada/);
    const rota = JSON.parse(encodeData({ ...empty(), transactions: [tx] }));
    rota.transactions[0].amount = "cien";
    expect(() => decodeData(JSON.stringify(rota))).toThrow(/transactions\.0\.amount/);
  });
});
