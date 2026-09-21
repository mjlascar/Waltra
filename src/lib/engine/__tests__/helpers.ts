import type { Account, Asset, PriceSeries, Transaction, TxType } from "@/lib/types";

let seq = 0;

export function tx(
  type: TxType,
  date: string,
  fields: Partial<Transaction> & { amount: number },
): Transaction {
  seq += 1;
  return {
    id: `tx${seq}`,
    type,
    date,
    accountId: fields.accountId ?? "cocos",
    currency: fields.currency ?? "USD",
    createdAt: `2020-01-01T00:00:${String(seq).padStart(2, "0")}.000Z`,
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...fields,
  };
}

export const cocos: Account = {
  id: "cocos",
  name: "Cocos Capital",
  broker: "cocos",
  currency: "USD",
  createdAt: "2020-01-01T00:00:00.000Z",
};

export const binance: Account = {
  id: "binance",
  name: "Binance",
  broker: "binance",
  currency: "USD",
  createdAt: "2020-01-01T00:00:00.000Z",
};

export function asset(id: string, over: Partial<Asset> = {}): Asset {
  return {
    id,
    symbol: id.toUpperCase(),
    name: id.toUpperCase(),
    kind: "etf",
    currency: "USD",
    source: "yahoo",
    sourceSymbol: id.toUpperCase(),
    precision: 4,
    ...over,
  };
}

/** Serie de precios constante o lineal entre dos valores. */
export function series(
  assetId: string,
  from: string,
  days: number,
  price: number | ((i: number) => number),
  currency: "USD" | "ARS" = "USD",
): PriceSeries {
  const points = [];
  const start = Date.parse(`${from}T00:00:00.000Z`);
  for (let i = 0; i < days; i++) {
    points.push({
      date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
      close: typeof price === "function" ? price(i) : price,
    });
  }
  return { assetId, currency, points, updatedAt: new Date().toISOString() };
}
