"use client";

import { useMemo } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { ReturnChart } from "@/components/charts/ReturnChart";
import { useStore } from "@/lib/store";
import { money, percent, quantity as fmtQty, shortDate, KIND_LABEL, TX_SHORT } from "@/lib/format";
import type { PositionView } from "@/lib/engine/portfolio";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db";

/** Detalle de una posicion: de donde viene el resultado y con que movimientos. */
export function PositionSheet({
  position,
  onClose,
}: {
  position: PositionView | null;
  onClose: () => void;
}) {
  const { transactions, accounts, assets } = useStore();
  const db = getDb();
  const assetId = position?.assetId;

  const series = useLiveQuery(
    async () => (db && assetId ? db.priceSeries.get(assetId) : undefined),
    [db, assetId],
  );

  const history = useMemo(() => {
    if (!series?.points.length) return [];
    const base = series.points[0].close;
    if (!base) return [];
    return series.points.map((p) => ({ day: p.date, value: p.close / base - 1 }));
  }, [series]);

  const moves = useMemo(
    () =>
      transactions
        .filter((t) => t.assetId === assetId)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [transactions, assetId],
  );

  if (!position) return null;
  const asset = assets.find((a) => a.id === position.assetId);

  return (
    <Sheet open onClose={onClose} title={position.symbol}>
      <div className="mb-4">
        <div className="eyebrow mb-1.5">
          {position.name} · {KIND_LABEL[position.kind] ?? position.kind}
        </div>
        <div className="num text-[26px] leading-none">{money(position.valueUsd, "USD")}</div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className={`num text-[13px] ${position.unrealizedUsd >= 0 ? "pos" : "neg"}`}>
            {money(position.unrealizedUsd, "USD", { sign: true })}
          </span>
          <span className={`num text-[12px] ${position.unrealizedUsd >= 0 ? "pos" : "neg"}`}>
            {percent(position.unrealizedPct, { decimals: 1 })}
          </span>
          <span className="label">no realizado</span>
        </div>
      </div>

      <div className="card mb-4 grid grid-cols-2" style={{ gap: 1, background: "var(--color-line)" }}>
        {[
          ["Cantidad", fmtQty(position.quantity, asset?.precision ?? 6)],
          ["Precio actual", position.price === null ? "sin dato" : money(position.price, position.currency)],
          ["Costo promedio", money(position.avgCost, position.currency)],
          ["Invertido", money(position.costUsd, "USD")],
          ["Peso en cartera", percent(position.weight, { decimals: 1, sign: false })],
          [
            "Realizado",
            position.realizedUsd === 0 ? "—" : money(position.realizedUsd, "USD", { sign: true }),
          ],
        ].map(([label, value]) => (
          <div key={label} style={{ background: "var(--color-surface)" }} className="p-3">
            <div className="eyebrow mb-1.5">{label}</div>
            <div className="num text-[13px]">{value}</div>
          </div>
        ))}
      </div>

      {history.length > 2 && (
        <div className="card mb-4 p-3">
          <div className="eyebrow mb-2">Variación del precio</div>
          <ReturnChart data={history} height={120} />
        </div>
      )}

      {position.priceMissing && (
        <p className="mb-4 text-[12px]" style={{ color: "var(--color-warn)" }}>
          No hay cotización para {position.symbol}. Está valuada al costo. Revisá el
          símbolo del proveedor en Ajustes → Activos.
        </p>
      )}

      <div className="eyebrow mb-2">Movimientos ({moves.length})</div>
      <div className="card divide-hairline mb-2">
        {moves.map((tx) => (
          <div key={tx.id} className="flex items-center gap-2.5 p-3">
            <span className="chip shrink-0">{TX_SHORT[tx.type]}</span>
            <div className="min-w-0 flex-1">
              <div className="num truncate text-[12px]">
                {tx.quantity
                  ? `${fmtQty(tx.quantity, 6)} @ ${money(tx.price ?? 0, tx.currency)}`
                  : "—"}
              </div>
              <div className="label mt-0.5">{shortDate(tx.date, true)}</div>
            </div>
            <span className="num shrink-0 text-[13px]">{money(tx.amount, tx.currency)}</span>
          </div>
        ))}
      </div>
      <p className="label">
        {position.accounts
          .map((a) => `${accounts.find((x) => x.id === a.accountId)?.name ?? "—"}: ${fmtQty(a.quantity, 6)}`)
          .join(" · ")}
      </p>
    </Sheet>
  );
}
