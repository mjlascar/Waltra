import type { Currency, PricePoint, QuoteSource } from "@/lib/types";
import type { DayKey } from "@/lib/date";
import { getJson } from "@/lib/net/json";

// El transporte vive en @/lib/net/json porque cambia entre la web y el APK.
// Los proveedores lo siguen importando desde aca para no enterarse.
export { getJson };

export interface MarketRef {
  assetId: string;
  symbol: string;
  source: QuoteSource;
  sourceSymbol: string;
  currency: Currency;
}

export interface QuoteResult {
  assetId: string;
  price: number | null;
  currency: Currency;
  changePct?: number;
  at: string;
  source: QuoteSource;
  error?: string;
}

export interface HistoryResult {
  assetId: string;
  currency: Currency;
  points: PricePoint[];
  error?: string;
}

export interface HistoryRequest extends MarketRef {
  from: DayKey;
}

/** Ejecuta en paralelo sin que un proveedor caido tumbe a los demas. */
export async function settleAll<T>(tasks: Promise<T>[]): Promise<(T | Error)[]> {
  const settled = await Promise.allSettled(tasks);
  return settled.map((s) =>
    s.status === "fulfilled" ? s.value : new Error(String(s.reason?.message ?? s.reason)),
  );
}
