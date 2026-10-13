import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/db";
import type { CloudData } from "../data";
import { discards, mergeData, shrinks } from "../merge";

type Tx = CloudData["transactions"][number];
type AssetRow = CloudData["assets"][number];

const account = (id: string): CloudData["accounts"][number] =>
  ({ id, name: id, broker: "other", currency: "USD", createdAt: "2026-01-01T00:00:00Z" });
const asset = (id: string, symbol = "ETH", over: Partial<AssetRow> = {}): AssetRow => ({
  id, symbol, name: symbol, kind: "crypto", currency: "USD", source: "binance",
  sourceSymbol: `${symbol}USDT`, precision: 8, ...over,
});
const tx = (id: string, over: Partial<Tx> = {}): Tx => ({
  id, date: "2026-10-01", type: "deposit", accountId: "cocos", amount: 100, currency: "USD",
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", ...over,
});
const buy = (id: string, assetId = "eth", over: Partial<Tx> = {}) =>
  tx(id, { type: "buy", assetId, quantity: 1, price: 100, ...over });
const data = (over: Partial<CloudData> = {}): CloudData => ({
  app: "waltra", version: 1, accounts: [account("cocos")], assets: [], transactions: [], insights: [],
  settings: { ...DEFAULT_SETTINGS }, ...over,
});
const ids = (d: CloudData) => d.transactions.map((t) => t.id).sort();

describe("combinar dos carteras desde la ultima copia confirmada", () => {
  it("suma lo que agrego cada lado y respeta lo que cada uno borro o edito", () => {
    const base = data({ transactions: [tx("a"), tx("b")] });
    const local = data({ transactions: [tx("b"), tx("c")] });
    const remote = data({ transactions: [tx("a"), tx("b", { amount: 250 }), tx("d")] });
    const merged = mergeData(base, local, remote);
    expect(merged.clashes).toBe(0);
    expect(merged.consistent).toBe(true);
    expect(ids(merged.data)).toEqual(["b", "c", "d"]);
    expect(merged.data.transactions.find((t) => t.id === "b")?.amount).toBe(250);
  });

  it("lo mismo cambiado distinto en los dos lados es un choque, y la preferencia lo decide", () => {
    const base = data({ transactions: [tx("a")] });
    const local = data({ transactions: [tx("a", { amount: 200 })] });
    const remote = data({ transactions: [tx("a", { amount: 300 })] });
    expect(mergeData(base, local, remote).clashes).toBe(1);
    expect(mergeData(base, local, remote, "local").data.transactions[0].amount).toBe(200);
    expect(mergeData(base, local, remote, "remote").data.transactions[0].amount).toBe(300);
    // Borrar de un lado y editar del otro tambien choca.
    expect(mergeData(base, data(), remote).clashes).toBe(1);
  });

  it("guardar sin cambiar nada no es un cambio", () => {
    const base = data({ transactions: [tx("a")] });
    const local = data({ transactions: [tx("a", { updatedAt: "2026-10-05T00:00:00Z" })] });
    const remote = data({ transactions: [tx("a", { amount: 300 })] });
    const merged = mergeData(base, local, remote);
    expect(merged.clashes).toBe(0);
    expect(merged.data.transactions[0].amount).toBe(300);
  });

  it("los ajustes se combinan campo por campo", () => {
    const base = data();
    const local = data({ settings: { ...DEFAULT_SETTINGS, compareMethod: "mensual" } });
    const remote = data({ settings: { ...DEFAULT_SETTINGS, goals: "La casa" } });
    const merged = mergeData(base, local, remote);
    expect(merged.clashes).toBe(0);
    expect(merged.data.settings).toMatchObject({ compareMethod: "mensual", goals: "La casa" });
    const otra = data({ settings: { ...DEFAULT_SETTINGS, compareMethod: "inicio" } });
    expect(mergeData(base, local, otra).clashes).toBe(1);
  });

  it("dos compras del mismo activo, una en cada equipo, se combinan", () => {
    const base = data({ assets: [asset("eth")], transactions: [buy("b1")] });
    const local = data({ assets: [asset("eth")], transactions: [buy("b1"), buy("b2")] });
    const remote = data({ assets: [asset("eth")], transactions: [buy("b1"), buy("b3")] });
    const merged = mergeData(base, local, remote);
    expect(merged.clashes).toBe(0);
    expect(ids(merged.data)).toEqual(["b1", "b2", "b3"]);
  });

  it("un ajuste de un activo que el otro lado opero choca: sumarlos cuenta dos veces", () => {
    // El ajuste anota la diferencia de hoy contra el broker. Si el broker ya
    // incluia la compra que se cargo en el otro telefono, combinar las dos
    // cuenta esas unidades dos veces.
    const base = data({ assets: [asset("eth")], transactions: [buy("b1")] });
    const local = data({ assets: [asset("eth")], transactions: [buy("b1"), tx("adj", { type: "adjust", assetId: "eth", quantity: 0.5 })] });
    const remote = data({ assets: [asset("eth")], transactions: [buy("b1"), buy("b2")] });
    expect(mergeData(base, local, remote).clashes).toBe(1);
    expect(ids(mergeData(base, local, remote, "local").data)).toEqual(["adj", "b1"]);
    expect(ids(mergeData(base, local, remote, "remote").data)).toEqual(["b1", "b2"]);
    // Otro activo no se entera.
    const otro = data({ assets: [asset("eth"), asset("btc", "BTC")], transactions: [buy("b1"), buy("b9", "btc")] });
    expect(mergeData(base, local, { ...otro, assets: [asset("eth"), asset("btc", "BTC")] }).clashes).toBe(0);
  });

  it("dos splits del mismo activo, uno de cada lado, chocan", () => {
    const base = data({ assets: [asset("spy", "SPY.BA")], transactions: [buy("b1", "spy")] });
    const split = (id: string, ratio: number) => tx(id, { type: "split", assetId: "spy", ratio, amount: 0 });
    const local = data({ assets: base.assets, transactions: [buy("b1", "spy"), split("s1", 2)] });
    const remote = data({ assets: base.assets, transactions: [buy("b1", "spy"), split("s2", 2.5)] });
    expect(mergeData(base, local, remote).clashes).toBe(1);
  });

  it("el mismo activo dado de alta en los dos equipos queda uno solo", () => {
    const spy = (id: string) => asset(id, "SPY.BA", { kind: "cedear", source: "byma", sourceSymbol: "SPY", currency: "ARS" });
    const base = data();
    const local = data({ assets: [spy("x-local")], transactions: [buy("b1", "x-local")] });
    const remote = data({ assets: [spy("a-remoto")], transactions: [buy("b2", "a-remoto")] });
    const merged = mergeData(base, local, remote);
    expect(merged.clashes).toBe(0);
    expect(merged.data.assets.map((a) => a.id)).toEqual(["a-remoto"]);
    expect(merged.data.transactions.map((t) => t.assetId)).toEqual(["a-remoto", "a-remoto"]);
    expect(merged.consistent).toBe(true);
  });

  it("un movimiento nuevo de un activo que el otro lado borro no se combina solo", () => {
    const base = data({ assets: [asset("eth")] });
    const local = data();
    const remote = data({ assets: [asset("eth")], transactions: [buy("b1")] });
    expect(mergeData(base, local, remote).consistent).toBe(false);
  });

  it("sabe si un resultado deja afuera algo que un lado cambio", () => {
    const base = data({ transactions: [tx("a")] });
    const local = data({ transactions: [tx("a"), tx("b")] });
    const remote = data({ transactions: [tx("a"), tx("c")] });
    const merged = mergeData(base, local, remote).data;
    expect(discards(base, local, merged)).toBe(false);
    expect(discards(base, remote, merged)).toBe(false);
    expect(discards(base, remote, local)).toBe(true);
    // Lo que el lado no toco no cuenta como descartado, y un borrado que no
    // se aplica tampoco: lo borrado sigue estando.
    expect(discards(base, base, remote)).toBe(false);
    expect(discards(base, data(), base)).toBe(false);
  });

  it("frena los borrados grandes, no el del movimiento de prueba", () => {
    const con = (n: number, prefix = "t") => data({ transactions: Array.from({ length: n }, (_, i) => tx(`${prefix}${i}`)) });
    expect(shrinks(con(1), con(0))).toBe(false);
    expect(shrinks(con(3), con(0))).toBe(true);
    expect(shrinks(con(20), con(9))).toBe(true);
    expect(shrinks(con(20), con(10))).toBe(false);
    expect(shrinks(con(9), con(1))).toBe(false);
    // Limpiar los datos de ejemplo se hace de a muchos a proposito.
    expect(shrinks(con(30, "demo-tx-"), con(0))).toBe(false);
  });

  it("con el mismo contenido gana la fila de Drive, asi dos telefonos convergen", () => {
    // Guardar sin cambiar nada o reimportar el mismo archivo deja otras marcas
    // de tiempo. Si cada lado se quedara con la suya, se la subirian para siempre.
    const base = data({ transactions: [tx("a")] });
    const local = data({ transactions: [tx("a", { updatedAt: "2026-10-05T00:00:00Z" })] });
    const remote = data({ transactions: [tx("a", { updatedAt: "2026-10-06T00:00:00Z" })] });
    expect(mergeData(base, local, remote).data.transactions[0].updatedAt).toBe("2026-10-06T00:00:00Z");
    expect(mergeData(base, remote, local).data.transactions[0].updatedAt).toBe("2026-10-05T00:00:00Z");
  });

  it("al unificar un activo repetido se queda con el que ya esta en Drive", () => {
    // El otro telefono puede seguir cargando movimientos con ese id.
    const spy = (id: string) => asset(id, "SPY.BA", { kind: "cedear", source: "byma", sourceSymbol: "SPY", currency: "ARS" });
    const enDrive = data({ assets: [spy("zzz")], transactions: [buy("b1", "zzz")] });
    const deB = mergeData(data(), data({ assets: [spy("aaa")], transactions: [buy("b2", "aaa")] }), enDrive);
    expect(deB.data.assets.map((a) => a.id)).toEqual(["zzz"]);
    expect(deB.data.transactions.map((t) => t.assetId)).toEqual(["zzz", "zzz"]);
    // El telefono que lo cargo primero sigue operando y combina sin preguntar.
    const deA = mergeData(enDrive, data({ assets: [spy("zzz")], transactions: [buy("b1", "zzz"), buy("b3", "zzz")] }), deB.data);
    expect(deA).toMatchObject({ clashes: 0, consistent: true });
    expect(ids(deA.data)).toEqual(["b1", "b2", "b3"]);
    // Juntar repetidos no cuenta como algo perdido.
    expect(discards(data(), data({ assets: [spy("aaa")], transactions: [buy("b2", "aaa")] }), deB.data)).toBe(false);
  });

  it("un movimiento de un activo que el otro lado unifico pasa al que quedo", () => {
    const spy = (id: string) => asset(id, "SPY.BA", { kind: "cedear", source: "byma", sourceSymbol: "SPY", currency: "ARS" });
    const base = data({ assets: [spy("zzz")], transactions: [buy("b1", "zzz")] });
    const local = data({ assets: [spy("zzz")], transactions: [buy("b1", "zzz"), buy("b3", "zzz")] });
    // Del otro lado, una version vieja unifico al reves y "zzz" ya no esta.
    const remote = data({ assets: [spy("aaa")], transactions: [buy("b1", "aaa"), buy("b2", "aaa")] });
    const merged = mergeData(base, local, remote);
    expect(merged.consistent).toBe(true);
    expect(merged.data.transactions.find((t) => t.id === "b3")?.assetId).toBe("aaa");
  });
});
