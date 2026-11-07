import type { Currency, TxType } from "@/lib/types";
import type { DayKey } from "@/lib/date";
import { blockersFor, type BulkRow } from "./bulk";
import type { ParsedEntry } from "./quick-add";
import { editableNumber, parseLooseNumber } from "./number";

/**
 * Una fila de la revision, en casillas.
 *
 * Lo que se leyo de las capturas (o de las notas) se revisa campo por campo:
 * corregir un precio no puede pedir reescribir una frase. Los numeros viajan
 * como texto, igual que en el formulario de un movimiento, para que la coma
 * decimal se pueda escribir y no se pierda al volver a mostrarla.
 */
export interface Edicion {
  type: TxType;
  day: DayKey;
  accountId: string;
  counterAccountId: string;
  symbol: string;
  quantity: string;
  price: string;
  amount: string;
  currency: Currency;
  toAmount: string;
  toCurrency: Currency;
}

/** Los tipos que se pueden elegir en una fila. */
export const TIPOS_EDITABLES: TxType[] = [
  "buy",
  "sell",
  "deposit",
  "withdraw",
  "dividend",
  "interest",
  "fee",
  "transfer",
  "exchange",
];

export const esOperacion = (t: TxType) => t === "buy" || t === "sell";

export function edicionDe(row: BulkRow, fallbackDay: DayKey, defaultAccountId: string): Edicion {
  const e = row.entry;
  const currency = e?.currency ?? "ARS";
  return {
    type: e?.type ?? "buy",
    day: e?.dateExplicit ? e.day : fallbackDay,
    accountId: e?.accountId ?? defaultAccountId,
    counterAccountId: e?.counterAccountId ?? "",
    symbol: e?.symbol ?? "",
    quantity: editableNumber(e?.quantity),
    price: editableNumber(e?.price),
    amount: editableNumber(e?.amount),
    currency,
    toAmount: editableNumber(e?.toAmount),
    toCurrency: e?.toCurrency ?? (currency === "ARS" ? "USD" : "ARS"),
  };
}

/**
 * Cambiar un campo de una operacion mantiene el total igual a cantidad por
 * precio, como lo cuenta el ledger (la comision va aparte): tocar la cantidad
 * o el precio rehace el total, y tocar el total rehace el precio.
 */
export function cambiar(ed: Edicion, campo: keyof Edicion, valor: string): Edicion {
  const next = { ...ed, [campo]: valor } as Edicion;
  if (!esOperacion(next.type)) return next;
  const q = parseLooseNumber(next.quantity);
  const p = parseLooseNumber(next.price);
  const a = parseLooseNumber(next.amount);
  if ((campo === "quantity" || campo === "price") && q && p) {
    next.amount = editableNumber(Math.round(q * p * 100) / 100, 2);
  } else if (campo === "amount" && q && a) {
    next.price = editableNumber(a / q, 6);
  }
  return next;
}

/**
 * La fila con lo que el usuario corrigio encima de lo que se leyo. Los
 * problemas se recalculan con las mismas reglas que al leer: una fila que se
 * completa a mano pasa a estar lista.
 */
export function aplicarEdicion(row: BulkRow, ed: Edicion): BulkRow {
  const trade = esOperacion(ed.type);
  const base = row.entry;
  const symbol = trade ? ed.symbol.trim().toUpperCase() || undefined : undefined;
  // Si el simbolo es el mismo que se leyo, se conserva la entrada del
  // catalogo; si cambio, la resuelve `resolveTradeAsset` al guardar.
  const mismo = base?.symbol && symbol && base.symbol.toUpperCase() === symbol;
  const entry: ParsedEntry = {
    basis: "amount" as const,
    confidence: 1,
    warnings: [],
    raw: row.raw,
    ...base,
    type: ed.type,
    all: undefined,
    dateExplicit: true,
    accountExplicit: true,
    day: ed.day,
    accountId: ed.accountId || undefined,
    counterAccountId: ed.type === "transfer" ? ed.counterAccountId || undefined : undefined,
    symbol,
    catalog: mismo ? base?.catalog : undefined,
    assetId: mismo ? base?.assetId : undefined,
    quantity: trade ? (parseLooseNumber(ed.quantity) ?? undefined) : undefined,
    price: trade ? (parseLooseNumber(ed.price) ?? undefined) : undefined,
    amount: parseLooseNumber(ed.amount) ?? undefined,
    currency: ed.currency,
    toAmount: ed.type === "exchange" ? (parseLooseNumber(ed.toAmount) ?? undefined) : undefined,
    toCurrency: ed.type === "exchange" ? ed.toCurrency : undefined,
    rate: undefined,
  };
  if (ed.type === "exchange" && entry.amount && entry.toAmount) {
    entry.rate = ed.currency === "ARS" ? entry.amount / entry.toAmount : entry.toAmount / entry.amount;
  }
  const blockers = blockersFor(entry);
  if (trade && !(entry.quantity && entry.quantity > 0)) blockers.push("Sin cantidad.");
  return { ...row, entry, blockers, include: blockers.length === 0 };
}
