import type { Transaction } from "@/lib/types";

/**
 * Los movimientos vistos desde una sola cuenta, para el grafico filtrado por
 * billetera.
 *
 * Una transferencia entre cuentas propias no es capital para la cartera, pero
 * si para cada billetera: la plata que sale de Cocos hacia Binance, mirada
 * desde Binance, entra. Asi que la que sale se vuelve un retiro y la que
 * llega, un ingreso. Sin esto, una billetera que solo recibio transferencias
 * mostraria capital cero y toda su plata como ganancia.
 *
 * Los cambios de ratio no tienen cuenta propia (rigen para el activo): se
 * quedan los de los activos que la cuenta opero.
 */
export function scopeToAccount(transactions: Transaction[], accountId: string): Transaction[] {
  return scopeToAccounts(transactions, [accountId]);
}

/**
 * Lo mismo para varias cuentas juntas, para los filtros de Cartera. Una
 * transferencia entre dos de las elegidas sigue siendo interna: la plata no
 * salio del conjunto que se esta mirando.
 */
export function scopeToAccounts(transactions: Transaction[], accountIds: string[]): Transaction[] {
  const elegidas = new Set(accountIds);
  const propios: Transaction[] = [];
  const activos = new Set<string>();
  for (const tx of transactions) {
    if (tx.type === "split") continue;
    if (tx.type === "transfer") {
      const sale = elegidas.has(tx.accountId);
      const llega = tx.counterAccountId !== undefined && elegidas.has(tx.counterAccountId);
      if (sale && llega) propios.push(tx);
      else if (sale) propios.push({ ...tx, type: "withdraw", counterAccountId: undefined });
      else if (llega) {
        // La comision la pago la cuenta de origen.
        propios.push({
          ...tx,
          type: "deposit",
          accountId: tx.counterAccountId!,
          counterAccountId: undefined,
          fee: undefined,
        });
      }
      continue;
    }
    if (!elegidas.has(tx.accountId)) continue;
    propios.push(tx);
    if (tx.assetId) activos.add(tx.assetId);
  }
  for (const tx of transactions) {
    if (tx.type === "split" && tx.assetId && activos.has(tx.assetId)) propios.push(tx);
  }
  return propios;
}
