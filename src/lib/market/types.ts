import type { Currency, PricePoint, QuoteSource } from "@/lib/types";
import type { DayKey } from "@/lib/date";

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

/** Envoltorio de fetch con timeout y errores legibles. */
export async function getJson<T>(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? 12_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        // Varios de estos endpoints publicos rechazan pedidos sin user-agent.
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
        Accept: "application/json,text/plain,*/*",
        ...init?.headers,
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    // "This operation was aborted" no le dice nada a nadie.
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`no respondió en ${Math.round(timeoutMs / 1000)} s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Ejecuta en paralelo sin que un proveedor caido tumbe a los demas. */
export async function settleAll<T>(tasks: Promise<T>[]): Promise<(T | Error)[]> {
  const settled = await Promise.allSettled(tasks);
  return settled.map((s) =>
    s.status === "fulfilled" ? s.value : new Error(String(s.reason?.message ?? s.reason)),
  );
}
