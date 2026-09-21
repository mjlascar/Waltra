"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type {
  Account,
  Asset,
  FxRate,
  InsightReport,
  PriceSeries,
  Quote,
  Settings,
  Transaction,
} from "@/lib/types";
import { DEFAULT_SETTINGS, ensureSeeded, getDb, type WaltraDB } from "@/lib/db";
import { computePortfolio, type Portfolio } from "@/lib/engine/portfolio";
import { addDays, today, toDay } from "@/lib/date";
import { BENCHMARK_ASSET_ID, benchmarkRef } from "@/lib/benchmark";

export type SyncState =
  | { status: "idle" }
  | { status: "syncing" }
  | { status: "ok"; at: string; mock: boolean }
  | { status: "error"; message: string };

interface StoreValue {
  ready: boolean;
  accounts: Account[];
  assets: Asset[];
  transactions: Transaction[];
  settings: Settings;
  insights: InsightReport[];
  portfolio: Portfolio;
  sync: SyncState;
  db: WaltraDB | null;

  refresh: (options?: { force?: boolean }) => Promise<void>;
  saveTransaction: (tx: Transaction) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  saveAsset: (asset: Asset) => Promise<void>;
  deleteAsset: (id: string) => Promise<void>;
  saveAccount: (account: Account) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  saveInsight: (report: InsightReport) => Promise<void>;
  apiHeaders: () => Record<string, string>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Los recursos que se releen en vivo desde IndexedDB. */
function useTable<T>(load: (db: WaltraDB) => Promise<T[]>, deps: unknown[] = []): T[] {
  const db = getDb();
  const rows = useLiveQuery(async () => (db ? load(db) : []), deps, undefined);
  return rows ?? [];
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const db = getDb();
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<SyncState>({ status: "idle" });
  const syncing = useRef(false);

  useEffect(() => {
    if (!db) return;
    let alive = true;
    ensureSeeded(db)
      .then(() => alive && setReady(true))
      .catch(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [db]);

  const accounts = useTable<Account>((d) => d.accounts.toArray());
  const assets = useTable<Asset>((d) => d.assets.toArray());
  const transactions = useTable<Transaction>((d) => d.transactions.toArray());
  const priceSeries = useTable<PriceSeries>((d) => d.priceSeries.toArray());
  const quotes = useTable<Quote>((d) => d.quotes.toArray());
  const fxRates = useTable<FxRate>((d) => d.fx.toArray());
  const insights = useTable<InsightReport>((d) =>
    d.insights.orderBy("createdAt").reverse().toArray(),
  );
  const settingsRow = useLiveQuery(async () => (db ? db.settings.get("settings") : undefined), [db]);

  const settings = useMemo<Settings>(
    () => ({ ...DEFAULT_SETTINGS, ...(settingsRow ?? {}) }),
    [settingsRow],
  );

  const portfolio = useMemo(
    () =>
      computePortfolio({
        transactions,
        assets,
        accounts,
        priceSeries,
        quotes,
        fxRates,
      }),
    [transactions, assets, accounts, priceSeries, quotes, fxRates],
  );

  const apiHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (settings.accessKey) headers["x-waltra-key"] = settings.accessKey;
    return headers;
  }, [settings.accessKey]);

  /** Trae cotizaciones, historia faltante y tipo de cambio. */
  const refresh = useCallback(
    async (options?: { force?: boolean }) => {
      if (!db || syncing.current) return;
      const live = await db.assets.toArray();
      const tradable = live.filter((a) => a.source !== "manual" && !a.archived);
      const txs = await db.transactions.toArray();
      const firstDay = txs.length
        ? txs.map((t) => toDay(t.date)).sort()[0]
        : addDays(today(), -365);

      syncing.current = true;
      setSync({ status: "syncing" });
      try {
        const existing = await db.priceSeries.toArray();
        const byAsset = new Map(existing.map((s) => [s.assetId, s]));

        // El indice de referencia se sincroniza siempre, tenga o no posiciones
        // el usuario: sin su historia no hay con que compararse.
        const reference = benchmarkRef(settings.benchmark);
        const referenceSeries = byAsset.get(BENCHMARK_ASSET_ID);
        const referenceStale =
          Boolean(reference) &&
          (!referenceSeries ||
            referenceSeries.points.length === 0 ||
            toDay(referenceSeries.updatedAt) < today() ||
            referenceSeries.points[0].date > firstDay);

        const needHistory = tradable
          .filter((asset) => {
            if (options?.force) return true;
            const series = byAsset.get(asset.id);
            if (!series || series.points.length === 0) return true;
            // Refrescamos si la serie quedo vieja o no llega hasta el primer
            // movimiento cargado (por ejemplo, despues de importar un backup).
            if (toDay(series.updatedAt) < today()) return true;
            return series.points[0].date > firstDay;
          })
          .map((a) => a.id);

        const res = await fetch("/api/market", {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify({
            refs: [
              ...tradable.map((a) => ({
                assetId: a.id,
                symbol: a.symbol,
                source: a.source,
                sourceSymbol: a.sourceSymbol,
                currency: a.currency,
              })),
              ...(reference ? [reference] : []),
            ],
            history: referenceStale ? [...needHistory, BENCHMARK_ASSET_ID] : needHistory,
            from: firstDay,
            includeFx: true,
          }),
        });
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          throw new Error(detail.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();

        const goodQuotes: Quote[] = (data.quotes ?? [])
          .filter((q: Quote) => q.price !== null && q.assetId !== BENCHMARK_ASSET_ID)
          .map((q: Quote) => ({ ...q }));
        if (goodQuotes.length) await db.quotes.bulkPut(goodQuotes);

        const series: PriceSeries[] = (data.history ?? [])
          .filter((h: { points: unknown[] }) => h.points.length > 0)
          .map((h: PriceSeries) => ({ ...h, updatedAt: new Date().toISOString() }));
        if (series.length) await db.priceSeries.bulkPut(series);

        if (Array.isArray(data.fx) && data.fx.length) await db.fx.bulkPut(data.fx);

        const at = new Date().toISOString();
        // Releemos los ajustes en vez de usar los del closure: si el usuario
        // toco su perfil mientras la sincronizacion estaba en vuelo, escribir
        // la copia vieja le borraria el cambio.
        const current = (await db.settings.get("settings")) ?? settings;
        await db.settings.put({ ...current, lastQuoteSync: at });
        setSync({ status: "ok", at, mock: Boolean(data.mock) });
      } catch (err) {
        setSync({ status: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        syncing.current = false;
      }
    },
    [db, apiHeaders, settings],
  );

  // Primer refresco automatico al abrir, y despues cada 10 minutos mientras la
  // pantalla este visible. No tiene sentido consumir bateria en segundo plano.
  const bootRef = useRef(false);
  useEffect(() => {
    if (!ready || !db || bootRef.current) return;
    // Alcanza con que haya algo cargado: alguien con depositos en pesos y sin
    // activos igual necesita el dolar para ver su total.
    if (assets.length === 0 && transactions.length === 0) return;
    bootRef.current = true;
    // Arrancar la busqueda al montar es justamente para lo que sirve un
    // efecto; que `refresh` marque "sincronizando" al empezar es parte de eso.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [ready, db, assets.length, transactions.length, refresh]);

  // El temporizador guarda la funcion en una referencia en vez de depender de
  // ella: `refresh` cambia de identidad cada vez que se tocan los ajustes, y
  // si el intervalo se recreara con cada cambio, alguien que edita su perfil
  // cada nueve minutos nunca veria un refresco automatico.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!ready) return;
    const tick = () => {
      if (document.visibilityState === "visible") void refreshRef.current();
    };
    const timer = setInterval(tick, 10 * 60 * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ready]);

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      accounts,
      assets,
      transactions,
      settings,
      insights,
      portfolio,
      sync,
      db,
      refresh,
      apiHeaders,
      saveTransaction: async (tx) => {
        await db?.transactions.put({ ...tx, updatedAt: new Date().toISOString() });
      },
      deleteTransaction: async (id) => {
        await db?.transactions.delete(id);
      },
      saveAsset: async (asset) => {
        await db?.assets.put(asset);
      },
      deleteAsset: async (id) => {
        if (!db) return;
        await db.transaction("rw", [db.assets, db.priceSeries, db.quotes], async () => {
          await db.assets.delete(id);
          await db.priceSeries.delete(id);
          await db.quotes.delete(id);
        });
      },
      saveAccount: async (account) => {
        await db?.accounts.put(account);
      },
      deleteAccount: async (id) => {
        await db?.accounts.delete(id);
      },
      updateSettings: async (patch) => {
        await db?.settings.put({ ...settings, ...patch, id: "settings" });
      },
      saveInsight: async (report) => {
        if (!db) return;
        await db.insights.put(report);
        // Guardamos los ultimos 20 informes y nada mas: la base vive en el
        // telefono y no tiene sentido que crezca sin techo.
        const all = await db.insights.orderBy("createdAt").reverse().toArray();
        const stale = all.slice(20).map((r) => r.id);
        if (stale.length) await db.insights.bulkDelete(stale);
      },
    }),
    [ready, accounts, assets, transactions, settings, insights, portfolio, sync, db, refresh, apiHeaders],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore necesita estar dentro de <StoreProvider>");
  return ctx;
}
