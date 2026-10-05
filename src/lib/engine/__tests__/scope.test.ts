import { describe, expect, it } from "vitest";
import { scopeToAccount, scopeToAccounts } from "@/lib/engine/scope";
import { computePortfolio } from "@/lib/engine/portfolio";
import { asset, binance, cocos, series, tx } from "./helpers";

const assets = [asset("qqq"), asset("btc", { kind: "crypto", source: "binance", precision: 8 })];
const txs = [
  tx("deposit", "2024-01-01", { amount: 1000, accountId: "cocos" }),
  tx("buy", "2024-01-02", { amount: 600, assetId: "qqq", quantity: 2, price: 300, accountId: "cocos" }),
  tx("transfer", "2024-01-05", { amount: 300, accountId: "cocos", counterAccountId: "binance", fee: 1 }),
  tx("buy", "2024-01-06", { amount: 200, assetId: "btc", quantity: 0.5, price: 400, accountId: "binance" }),
];
const correr = (transactions: typeof txs, accounts = [cocos, binance]) =>
  computePortfolio({
    transactions,
    assets,
    accounts,
    priceSeries: [series("qqq", "2024-01-01", 60, 330), series("btc", "2024-01-01", 60, 500)],
    quotes: [
      { assetId: "qqq", price: 330, currency: "USD", at: "2024-02-01", source: "yahoo" },
      { assetId: "btc", price: 500, currency: "USD", at: "2024-02-01", source: "binance" },
    ],
    fxRates: [],
    asOf: "2024-02-01",
  });

describe("una sola billetera", () => {
  it("la transferencia que llega es su capital", () => {
    const p = correr(scopeToAccount(txs, "binance"), [binance]);
    expect(p.netContributedUsd).toBeCloseTo(300);
    expect(p.totalValueUsd).toBeCloseTo(100 + 250);
    expect(p.totalPnlUsd).toBeCloseTo(50);
  });

  it("la que sale es un retiro, con su comisión", () => {
    const p = correr(scopeToAccount(txs, "cocos"), [cocos]);
    expect(p.netContributedUsd).toBeCloseTo(700);
    expect(p.totalValueUsd).toBeCloseTo(99 + 660);
  });

  it("las dos billeteras suman la cartera entera", () => {
    const todo = correr(txs);
    const a = correr(scopeToAccount(txs, "cocos"), [cocos]);
    const b = correr(scopeToAccount(txs, "binance"), [binance]);
    expect(a.totalValueUsd + b.totalValueUsd).toBeCloseTo(todo.totalValueUsd, 6);
    expect(a.totalPnlUsd + b.totalPnlUsd).toBeCloseTo(todo.totalPnlUsd, 6);
  });

  it("los cambios de ratio de un activo que la cuenta no operó quedan afuera", () => {
    const conSplit = [...txs, tx("split", "2024-01-20", { amount: 0, assetId: "qqq", ratio: 2 })];
    expect(scopeToAccount(conSplit, "binance").some((t) => t.type === "split")).toBe(false);
    expect(scopeToAccount(conSplit, "cocos").some((t) => t.type === "split")).toBe(true);
  });
});

describe("varias cuentas juntas", () => {
  it("las dos juntas son la cartera entera: la transferencia sigue siendo interna", () => {
    const entera = correr(txs);
    const juntas = correr(scopeToAccounts(txs, ["cocos", "binance"]));
    expect(juntas.netContributedUsd).toBeCloseTo(entera.netContributedUsd);
    expect(juntas.totalValueUsd).toBeCloseTo(entera.totalValueUsd);
    expect(juntas.totalPnlUsd).toBeCloseTo(entera.totalPnlUsd);
  });

  it("con una sola, es lo mismo que la billetera sola", () => {
    const sola = correr(scopeToAccount(txs, "binance"), [binance]);
    const lista = correr(scopeToAccounts(txs, ["binance"]), [binance]);
    expect(lista.totalValueUsd).toBeCloseTo(sola.totalValueUsd);
    expect(lista.netContributedUsd).toBeCloseTo(sola.netContributedUsd);
  });
});
