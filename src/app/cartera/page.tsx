"use client";

import { useMemo, useState } from "react";
import { Header } from "@/components/ui/Header";
import { TweenMoney } from "@/components/ui/TweenMoney";
import { SectionTitle } from "@/components/ui/Stat";
import { PnlBars } from "@/components/charts/PnlBars";
import { Sparkline } from "@/components/charts/Sparkline";
import { PositionSheet } from "@/components/PositionSheet";
import { SalesList } from "@/components/SalesList";
import { AssetEditor } from "@/components/AssetEditor";
import { EmptyStart } from "@/components/EmptyStart";
import { IconChevron } from "@/components/icons";
import { useStore } from "@/lib/store";
import type { Asset } from "@/lib/types";
import { money, percent, quantity as fmtQty, KIND_LABEL } from "@/lib/format";
import { getDb } from "@/lib/db";
import { useLiveQuery } from "dexie-react-hooks";
import type { PositionView } from "@/lib/engine/portfolio";

export default function Cartera() {
  const { portfolio: full, portfolioFor, accounts, assets, ready, saveAsset, refresh } = useStore();
  const display = full.base;
  /**
   * Los filtros: cuentas y tipos, de a varios. Vacio es todo. No cambian la
   * pantalla, la recortan: las mismas metricas, la misma lista y los mismos
   * resultados, solo de lo elegido. Antes eran tres vistas distintas, y la de
   * cuenta y la de tipo decian mucho menos que la de activo.
   */
  const [cuentasElegidas, setCuentasElegidas] = useState<string[]>([]);
  const [tiposElegidos, setTiposElegidos] = useState<string[]>([]);
  /**
   * Cuantos activos se ven: 5 al entrar, 10 mas con un toque y todos con el
   * segundo. Sin el paso intermedio, llegar al final con muchos activos eran
   * muchos toques; sin el primero, la pantalla arrancaba con la lista entera.
   */
  const [cuantosActivos, setCuantosActivos] = useState(5);
  const [selected, setSelected] = useState<PositionView | null>(null);
  const [fixing, setFixing] = useState<Asset | null>(null);
  const db = getDb();

  // Los ultimos 30 cierres de cada activo alimentan las mini lineas.
  const sparks = useLiveQuery(async () => {
    if (!db) return {};
    const rows = await db.priceSeries.toArray();
    const out: Record<string, number[]> = {};
    for (const row of rows) out[row.assetId] = row.points.slice(-30).map((x) => x.close);
    return out;
  }, [db]);

  /**
   * La mini linea se dibuja como precio sobre costo promedio, no como precio a
   * secas: asi su color y el porcentaje que esta al lado no se contradicen
   * (una linea roja junto a un +15% es exactamente lo que no queremos).
   */
  const sparkFor = (pos: PositionView): number[] => {
    const raw = sparks?.[pos.assetId] ?? [];
    if (!raw.length || pos.avgCost <= 0) return raw;
    return raw.map((price) => price / pos.avgCost);
  };

  // Las cuentas que tienen algo, y los tipos de lo que se tuvo alguna vez.
  const cuentasConDatos = useMemo(
    () =>
      full.accountViews
        .filter((a) => a.valueUsd > 0.01 || a.netContributedUsd !== 0)
        .sort((a, b) => b.valueUsd - a.valueUsd),
    [full.accountViews],
  );
  const porCuenta = useMemo(
    () =>
      cuentasElegidas.length > 0 && cuentasElegidas.length < cuentasConDatos.length
        ? portfolioFor(cuentasElegidas)
        : full,
    [full, portfolioFor, cuentasElegidas, cuentasConDatos.length],
  );
  // Los tipos de lo que hay en las cuentas elegidas: con Binance sola no se
  // ofrece CEDEAR. Los ya elegidos quedan, para poder apagarlos.
  const tipos = useMemo(() => {
    const vistos = new Set<string>(tiposElegidos);
    for (const pos of porCuenta.positions) vistos.add(pos.kind);
    for (const pos of porCuenta.closedPositions) vistos.add(pos.kind);
    return [...vistos];
  }, [porCuenta.positions, porCuenta.closedPositions, tiposElegidos]);

  /**
   * Lo que se mira. Por cuenta, la cartera recortada a esas cuentas, con su
   * capital y sus transferencias bien contadas (ver `scopeToAccounts`). Por
   * tipo, solo sus activos: la liquidez no tiene tipo, asi que no se muestra.
   */
  const p = useMemo(() => {
    if (tiposElegidos.length === 0) return porCuenta;
    const entra = (kind: string) => tiposElegidos.includes(kind);
    const positions = porCuenta.positions.filter((pos) => entra(pos.kind));
    const closedPositions = porCuenta.closedPositions.filter((pos) => entra(pos.kind));
    const kindOf = new Map(assets.map((a) => [a.id, a.kind as string]));
    const sales = porCuenta.sales.filter((s) => entra(kindOf.get(s.assetId) ?? ""));
    const investedUsd = positions.reduce((acc, pos) => acc + pos.valueUsd, 0);
    return {
      ...porCuenta,
      positions: positions.map((pos) => ({
        ...pos,
        weight: investedUsd > 0 ? pos.valueUsd / investedUsd : 0,
      })),
      closedPositions,
      sales,
      investedUsd,
      unrealizedUsd: positions.reduce((acc, pos) => acc + pos.unrealizedUsd, 0),
      realizedUsd: sales.reduce((acc, v) => acc + v.pnl, 0),
      cashUsd: 0,
    };
  }, [porCuenta, tiposElegidos, assets]);
  const filtrando = cuentasElegidas.length > 0 || tiposElegidos.length > 0;

  const alternar = (lista: string[], valor: string) =>
    lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor];

  const pnlRows = useMemo(
    () =>
      [...p.positions]
        .sort((a, b) => b.unrealizedUsd - a.unrealizedUsd)
        .map((pos) => ({
          key: pos.assetId,
          label: pos.symbol,
          // Sin realizar, como dice el titulo: lo realizado de cada activo
          // esta en la lista de ventas, y sumarlo aca lo contaba en dos lados.
          value: pos.unrealizedUsd,
          pct: pos.unrealizedPct,
        })),
    [p.positions],
  );

  if (!ready) return <div className="py-20 text-center"><span className="label">Abriendo…</span></div>;
  if (!p.hasData) return <EmptyStart />;

  return (
    <div className="pb-6">
      <Header title="Cartera" />

      {p.missingPrices.length > 0 && (
        <div
          className="mb-4 p-3"
          style={{ border: "1px solid var(--color-line-strong)", background: "var(--color-surface)" }}
        >
          <p className="text-[12px] leading-snug" style={{ color: "var(--color-warn)" }}>
            Sin cotización para {p.missingPrices.join(", ")}. Están valuados al costo.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.missingPrices.map((symbol) => {
              const asset = assets.find((a) => a.symbol === symbol);
              if (!asset) return null;
              return (
                <button key={symbol} className="chip" onClick={() => setFixing(asset)}>
                  Arreglar {symbol}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <section className="mb-4">
        <div className="eyebrow mb-2">Invertido</div>
        <div className="hero-num">
          <TweenMoney value={p.investedUsd} currency={display} />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className={`num text-[14px] ${p.unrealizedUsd >= 0 ? "pos" : "neg"}`}>
            {money(p.unrealizedUsd, display, { sign: true })}
          </span>
          <span className="label">sin realizar</span>
        </div>
        {p.realizedUsd !== 0 && (
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`num text-[12px] ${p.realizedUsd >= 0 ? "pos" : "neg"}`}>
              {money(p.realizedUsd, display, { sign: true })}
            </span>
            <span className="label">realizado al vender</span>
          </div>
        )}
        {p.cashUsd > 0.01 && (
          <p className="label mt-2">{money(p.cashUsd, display)} de liquidez</p>
        )}
      </section>

      {(cuentasConDatos.length > 1 || tipos.length > 1) && (
        <div className="mb-3 space-y-2">
          {cuentasConDatos.length > 1 && (
            <FiltroFila
              titulo="Cuentas"
              opciones={cuentasConDatos.map((c) => ({ value: c.accountId, label: c.name }))}
              elegidos={cuentasElegidas}
              onToggle={(v) => setCuentasElegidas((prev) => alternar(prev, v))}
            />
          )}
          {tipos.length > 1 && (
            <FiltroFila
              titulo="Tipos"
              opciones={tipos.map((k) => ({ value: k, label: KIND_LABEL[k] ?? k }))}
              elegidos={tiposElegidos}
              onToggle={(v) => setTiposElegidos((prev) => alternar(prev, v))}
            />
          )}
          {filtrando && (
            <button
              className="label underline"
              onClick={() => {
                setCuentasElegidas([]);
                setTiposElegidos([]);
              }}
            >
              Ver todo
            </button>
          )}
        </div>
      )}

      <section className="card divide-hairline stagger mb-5">
        {p.positions.slice(0, cuantosActivos).map((pos) => (
          <button
            key={pos.assetId}
            onClick={() => setSelected(pos)}
            className="flex w-full items-center gap-2.5 p-3 text-left"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-[14px] font-medium">{pos.symbol}</span>
                <span className="num text-[10px]" style={{ color: "var(--color-ink-3)" }}>
                  {percent(pos.weight, { decimals: 0, sign: false })}
                </span>
              </div>
              <div className="label mt-0.5 truncate">
                {fmtQty(pos.quantity, 4)} · {money(pos.avgCostUsd, display)}
              </div>
            </div>

            <Sparkline
              values={sparkFor(pos)}
              tone={pos.unrealizedUsd >= 0 ? "var(--color-pos)" : "var(--color-neg)"}
            />

            <div className="shrink-0 text-right">
              <div className="num text-[13px]">{money(pos.valueUsd, display, { compact: true })}</div>
              <div className={`num text-[11px] ${pos.unrealizedUsd >= 0 ? "pos" : "neg"}`}>
                {percent(pos.unrealizedPct, { decimals: 1 })}
              </div>
            </div>
            <IconChevron size={13} className="shrink-0" />
          </button>
        ))}
        {p.positions.length === 0 && (
          <p className="label p-6 text-center">
            {filtrando ? "Nada con estos filtros." : "Todavía no compraste nada."}
          </p>
        )}
      </section>
      {p.positions.length > 5 && (
        <div className="-mt-3 mb-5">
          <button
            className="chip"
            onClick={() =>
              setCuantosActivos(
                cuantosActivos >= p.positions.length
                  ? 5
                  : cuantosActivos === 5 && p.positions.length > 15
                    ? 15
                    : p.positions.length,
              )
            }
          >
            {cuantosActivos >= p.positions.length
              ? "Mostrar menos"
              : cuantosActivos === 5 && p.positions.length > 15
                ? "Mostrar 10 más"
                : "Mostrar todos"}
          </button>
        </div>
      )}

      {pnlRows.length > 0 && (
        <section className="mb-5">
          <SectionTitle>Resultado sin realizar</SectionTitle>
          <div className="card p-3">
            <PnlBars rows={pnlRows} currency={display} fold />
          </div>
        </section>
      )}

      <SalesList portfolio={p} />

      {accounts.length === 0 && <p className="label">No hay cuentas configuradas.</p>}

      <PositionSheet position={selected} onClose={() => setSelected(null)} />

      {fixing && (
        <AssetEditor
          asset={fixing}
          canDelete={false}
          onClose={() => setFixing(null)}
          onSave={async (next) => {
            await saveAsset(next);
            setFixing(null);
            void refresh({ force: true });
          }}
          onDelete={async () => setFixing(null)}
        />
      )}
    </div>
  );
}

/**
 * Una fila de filtros que se prenden y apagan de a uno, varios a la vez.
 * Ninguno prendido es todo: no hace falta un "Todas" que compita con los
 * demas.
 */
function FiltroFila({
  titulo,
  opciones,
  elegidos,
  onToggle,
}: {
  titulo: string;
  opciones: { value: string; label: string }[];
  elegidos: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div role="group" aria-label={titulo} className="flex items-center gap-2">
      <span className="eyebrow w-14 shrink-0">{titulo}</span>
      <div className="no-scrollbar flex min-w-0 gap-1.5 overflow-x-auto">
        {opciones.map((o) => {
          const activo = elegidos.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={activo}
              onClick={() => onToggle(o.value)}
              className="filter-chip shrink-0"
              data-active={activo}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
