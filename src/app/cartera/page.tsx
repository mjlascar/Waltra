"use client";

import { useMemo, useState } from "react";
import { Header } from "@/components/ui/Header";
import { SectionTitle } from "@/components/ui/Stat";
import { Segmented } from "@/components/ui/Field";
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

type Group = "activo" | "cuenta" | "tipo";

export default function Cartera() {
  const { portfolio: p, accounts, assets, ready, saveAsset, refresh } = useStore();
  const display = p.base;
  const [group, setGroup] = useState<Group>("activo");
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

  const byKind = useMemo(() => {
    const totals = new Map<string, number>();
    for (const pos of p.positions) {
      totals.set(pos.kind, (totals.get(pos.kind) ?? 0) + pos.valueUsd);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [p.positions]);

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
        <div className="hero-num">{money(p.investedUsd, display)}</div>
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

      <div className="mb-3">
        <Segmented
          value={group}
          onChange={setGroup}
          options={[
            { value: "activo", label: "Por activo" },
            { value: "cuenta", label: "Por cuenta" },
            { value: "tipo", label: "Por tipo" },
          ]}
        />
      </div>

      {group === "activo" && (
        <section className="card divide-hairline mb-5">
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
            <p className="label p-6 text-center">Todavía no compraste nada.</p>
          )}
        </section>
      )}
      {group === "activo" && p.positions.length > 5 && (
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

      {group === "cuenta" && (
        <section className="mb-5 space-y-3">
          {[...p.accountViews]
            .sort((a, b) => b.valueUsd - a.valueUsd)
            .map((account) => {
              const held = p.positions.filter((pos) =>
                pos.accounts.some((a) => a.accountId === account.accountId),
              );
              return (
                <div key={account.accountId} className="card">
                  <div className="flex items-center justify-between p-3">
                    <div>
                      <div className="text-[14px] font-medium">{account.name}</div>
                      <div className="label mt-0.5">
                        {held.length} {held.length === 1 ? "posición" : "posiciones"} ·{" "}
                        {money(account.cashUsd, display, { compact: true })} líquido
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="num text-[14px]">
                        {money(account.valueUsd, display, { compact: true })}
                      </div>
                      <div className={`num text-[11px] ${account.pnlUsd >= 0 ? "pos" : "neg"}`}>
                        {money(account.pnlUsd, display, { compact: true, sign: true })}
                      </div>
                    </div>
                  </div>
                  {held.length > 0 && (
                    <div className="divide-hairline hairline">
                      {held.map((pos) => {
                        const qty =
                          pos.accounts.find((a) => a.accountId === account.accountId)?.quantity ?? 0;
                        const share = pos.quantity > 0 ? qty / pos.quantity : 0;
                        return (
                          <button
                            key={pos.assetId}
                            onClick={() => setSelected(pos)}
                            className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                          >
                            <span className="min-w-0 flex-1 truncate text-[13px]">{pos.symbol}</span>
                            <span className="label shrink-0">{fmtQty(qty, 4)}</span>
                            <span className="num shrink-0 text-[12px]">
                              {money(pos.valueUsd * share, display, { compact: true })}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
        </section>
      )}

      {group === "tipo" && (
        <section className="card divide-hairline mb-5">
          {byKind.map(([kind, value]) => (
            <div key={kind} className="flex items-center gap-3 p-3">
              <span className="min-w-0 flex-1 text-[13px]">{KIND_LABEL[kind] ?? kind}</span>
              <span className="num text-[12px]" style={{ color: "var(--color-ink-3)" }}>
                {percent(p.investedUsd > 0 ? value / p.investedUsd : 0, { decimals: 0, sign: false })}
              </span>
              <span className="num text-[13px]">{money(value, display, { compact: true })}</span>
            </div>
          ))}
        </section>
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
