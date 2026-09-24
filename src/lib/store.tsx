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
import { marketPriceOn, type MarketPrice } from "@/lib/engine/market-price";
import { addDays, today, toDay } from "@/lib/date";
import { syncMarket, type BackendContext } from "@/lib/backend";
import { proveedoresCaidos } from "@/lib/market/down";
import { keyFor, resolveProvider } from "@/lib/insights/providers";
import { BENCHMARK_ASSET_ID, benchmarkRef } from "@/lib/benchmark";

export type SyncState =
  | { status: "idle" }
  | { status: "syncing" }
  /** `down`: proveedores que no contestaron nada en esta pasada. */
  | { status: "ok"; at: string; mock: boolean; down: string[] }
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
  /** Lo que la capa de backend necesita para saber con quien hablar. */
  backend: () => BackendContext;
  /** Lo que cotizaba un activo ese dia, en la moneda pedida. Ver `market-price.ts`. */
  marketPrice: (assetId: string, day: string, currency: Asset["currency"]) => MarketPrice | null;
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

  const backend = useCallback(
    (): BackendContext => ({
      accessKey: settings.accessKey,
      // La del proveedor elegido: la capa de backend no tiene por que saber
      // que hay mas de una guardada.
      apiKey: keyFor(resolveProvider(settings.provider), settings),
    }),
    [settings],
  );

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

        const hadArs = live.some((a) => a.currency === "ARS") || txs.some((t) => t.currency === "ARS");
        const data = await syncMarket(
          {
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
          },
          backend(),
        );

        // Una cotizacion sin precio es un proveedor que fallo, no un precio
        // de cero: se descarta en vez de guardarse.
        const goodQuotes: Quote[] = [];
        for (const q of data.quotes) {
          if (q.price === null || q.assetId === BENCHMARK_ASSET_ID) continue;
          goodQuotes.push({ ...q, price: q.price });
        }
        if (goodQuotes.length) await db.quotes.bulkPut(goodQuotes);

        const now = new Date().toISOString();
        const series: PriceSeries[] = data.history
          .filter((h) => h.points.length > 0)
          .map((h) => ({
            assetId: h.assetId,
            currency: h.currency,
            points: h.points,
            // La serie y sus splits vienen de la misma respuesta: guardarlos
            // juntos es lo que garantiza que se lean de manera coherente.
            splits: h.splits?.length ? h.splits : undefined,
            updatedAt: now,
          }));
        if (series.length) await db.priceSeries.bulkPut(series);

        if (data.fx.length) await db.fx.bulkPut(data.fx);

        const at = new Date().toISOString();
        // Releemos los ajustes en vez de usar los del closure: si el usuario
        // toco su perfil mientras la sincronizacion estaba en vuelo, escribir
        // la copia vieja le borraria el cambio.
        const current = (await db.settings.get("settings")) ?? settings;
        await db.settings.put({ ...current, lastQuoteSync: at });

        const down = proveedoresCaidos(data.quotes);
        // El dolar tiene su propio proveedor y su propio silencio.
        if (hadArs && data.fx.length === 0 && !data.fxLatest) down.push("el dólar MEP");
        setSync({ status: "ok", at, mock: Boolean(data.mock), down });
      } catch (err) {
        setSync({ status: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        syncing.current = false;
      }
    },
    [db, backend, settings],
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
      backend,
      marketPrice: (assetId, day, currency) => {
        const asset = assets.find((a) => a.id === assetId);
        if (!asset) return null;
        return marketPriceOn({
          asset,
          day,
          currency,
          today: today(),
          quotes,
          priceSeries,
          fxRates,
          splits: portfolio.splits[assetId],
        });
      },
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
    [ready, accounts, assets, transactions, settings, insights, portfolio, sync, db, refresh, backend, quotes, priceSeries, fxRates],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore necesita estar dentro de <StoreProvider>");
  return ctx;
}
