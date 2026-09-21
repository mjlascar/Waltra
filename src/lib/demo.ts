import type { Asset, Transaction } from "@/lib/types";
import { lookupCatalog } from "@/lib/catalog";
import { addDays, today } from "@/lib/date";
import { defaultAccounts, type WaltraDB } from "@/lib/db";

/**
 * Carga una cartera de ejemplo para poder ver la app funcionando antes de
 * cargar datos propios. Todo lo que crea queda marcado con la nota "ejemplo",
 * asi que se puede limpiar sin tocar nada real.
 */

const DEMO_NOTE = "ejemplo";

function assetFrom(symbol: string): Asset {
  const entry = lookupCatalog(symbol);
  if (!entry) throw new Error(`Falta ${symbol} en el catalogo`);
  return {
    id: `demo-${entry.symbol.toLowerCase()}`,
    symbol: entry.symbol,
    name: entry.name,
    kind: entry.kind,
    currency: entry.currency,
    source: entry.source,
    sourceSymbol: entry.sourceSymbol,
    precision: entry.precision,
  };
}

export async function loadDemoData(db: WaltraDB): Promise<void> {
  const now = today();
  const at = (daysAgo: number) => addDays(now, -daysAgo);
  const assets = ["QQQ", "SPY", "BTC", "ETH", "MELI"].map(assetFrom);

  let seq = 0;
  const tx = (
    partial: Omit<Transaction, "id" | "createdAt" | "updatedAt" | "note"> & { note?: string },
  ): Transaction => {
    seq += 1;
    return {
      ...partial,
      id: `demo-tx-${seq}`,
      note: partial.note ?? DEMO_NOTE,
      createdAt: new Date(2020, 0, 1, 0, 0, seq).toISOString(),
      updatedAt: new Date().toISOString(),
    };
  };

  // Una historia creible: aportes mensuales, alguna venta, un dividendo y una
  // transferencia entre cuentas.
  const transactions: Transaction[] = [
    tx({ date: at(400), type: "deposit", accountId: "cocos", amount: 1200, currency: "USD" }),
    tx({ date: at(398), type: "buy", accountId: "cocos", assetId: "demo-qqq", quantity: 1.5, price: 430, amount: 645, currency: "USD" }),
    tx({ date: at(398), type: "buy", accountId: "cocos", assetId: "demo-spy", quantity: 1, price: 510, amount: 510, currency: "USD" }),
    tx({ date: at(330), type: "deposit", accountId: "binance", amount: 800, currency: "USD" }),
    tx({ date: at(329), type: "buy", accountId: "binance", assetId: "demo-btc", quantity: 0.008, price: 62_000, amount: 496, currency: "USD" }),
    tx({ date: at(329), type: "buy", accountId: "binance", assetId: "demo-eth", quantity: 0.09, price: 3_300, amount: 297, currency: "USD" }),
    tx({ date: at(250), type: "deposit", accountId: "cocos", amount: 500, currency: "USD" }),
    tx({ date: at(249), type: "buy", accountId: "cocos", assetId: "demo-meli", quantity: 0.26, price: 1_850, amount: 481, currency: "USD" }),
    tx({ date: at(180), type: "deposit", accountId: "cocos", amount: 400, currency: "USD" }),
    tx({ date: at(178), type: "buy", accountId: "cocos", assetId: "demo-qqq", quantity: 0.8, price: 470, amount: 376, currency: "USD" }),
    tx({ date: at(120), type: "dividend", accountId: "cocos", assetId: "demo-spy", amount: 6.4, currency: "USD" }),
    tx({ date: at(95), type: "deposit", accountId: "binance", amount: 300, currency: "USD" }),
    tx({ date: at(94), type: "buy", accountId: "binance", assetId: "demo-btc", quantity: 0.003, price: 88_000, amount: 264, currency: "USD" }),
    tx({ date: at(60), type: "sell", accountId: "cocos", assetId: "demo-spy", quantity: 0.4, price: 580, amount: 232, currency: "USD", fee: 1.2 }),
    tx({ date: at(45), type: "transfer", accountId: "cocos", counterAccountId: "binance", amount: 150, currency: "USD" }),
    tx({ date: at(44), type: "buy", accountId: "binance", assetId: "demo-eth", quantity: 0.045, price: 3_150, amount: 141.75, currency: "USD" }),
    tx({ date: at(20), type: "deposit", accountId: "cocos", amount: 350, currency: "USD" }),
    tx({ date: at(19), type: "buy", accountId: "cocos", assetId: "demo-qqq", quantity: 0.65, price: 492, amount: 319.8, currency: "USD" }),
  ];

  await db.transaction("rw", [db.accounts, db.assets, db.transactions], async () => {
    if ((await db.accounts.count()) === 0) await db.accounts.bulkPut(defaultAccounts());
    await db.assets.bulkPut(assets);
    await db.transactions.bulkPut(transactions);
  });
}

export async function clearDemoData(db: WaltraDB): Promise<void> {
  await db.transaction("rw", [db.assets, db.transactions, db.priceSeries, db.quotes], async () => {
    const txs = await db.transactions.toArray();
    await db.transactions.bulkDelete(txs.filter((t) => t.id.startsWith("demo-")).map((t) => t.id));
    const assets = await db.assets.toArray();
    const demoAssets = assets.filter((a) => a.id.startsWith("demo-")).map((a) => a.id);
    await db.assets.bulkDelete(demoAssets);
    await db.priceSeries.bulkDelete(demoAssets);
    await db.quotes.bulkDelete(demoAssets);
  });
}

export function hasDemoData(transactionIds: string[]): boolean {
  return transactionIds.some((id) => id.startsWith("demo-"));
}
