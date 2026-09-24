"use client";

import { useMemo, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { ReturnChart, type ReturnMark } from "@/components/charts/ReturnChart";
import { useStore } from "@/lib/store";
import { money, percent, quantity as fmtQty, shortDate, KIND_LABEL, TX_SHORT } from "@/lib/format";
import type { PositionView } from "@/lib/engine/portfolio";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db";
import { SplitSheet } from "@/components/SplitSheet";

/** Detalle de una posicion: de donde viene el resultado y con que movimientos. */
export function PositionSheet({
  position,
  onClose,
}: {
  position: PositionView | null;
  onClose: () => void;
}) {
  const { transactions, accounts, assets, portfolio } = useStore();
  const [cargandoRatio, setCargandoRatio] = useState(false);
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

  /**
   * El costo promedio, en las mismas unidades que la curva.
   *
   * La serie esta indexada al primer cierre, asi que el costo tambien: arriba
   * de esa linea la posicion esta en ganancia y abajo en perdida. Sin esto, el
   * grafico dice como se movio el precio y no dice nada sobre vos.
   */
  const avgCost = position?.avgCost;
  const moneda = position?.currency;
  const nivelCosto = useMemo(() => {
    const base = series?.points[0]?.close;
    if (!base || !avgCost || !moneda) return undefined;
    return {
      value: avgCost / base - 1,
      label: `costo ${money(avgCost, moneda, { compact: true })}`,
    };
  }, [series, avgCost, moneda]);

  /**
   * Cada compra y cada venta, ubicadas en el dia que pasaron.
   *
   * Si operaste un dia sin cotizacion —un feriado, un fin de semana en una
   * accion— la marca se corre al dia habil mas cercano en vez de perderse:
   * descartarla en silencio dejaria el grafico diciendo que compraste menos
   * veces de las que compraste.
   */
  const marcas = useMemo((): ReturnMark[] => {
    const puntos = series?.points;
    if (!puntos?.length || !assetId) return [];
    const dias = puntos.map((p) => p.date);
    const cercano = (day: string) => {
      if (day < dias[0] || day > dias[dias.length - 1]) return null;
      let lo = 0;
      let hi = dias.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (dias[mid] < day) lo = mid + 1;
        else hi = mid;
      }
      // `lo` es el primer dia >= al buscado; el anterior puede estar mas cerca.
      if (lo > 0 && dias[lo] !== day) {
        const anterior = Math.abs(Date.parse(dias[lo - 1]) - Date.parse(day));
        const siguiente = Math.abs(Date.parse(dias[lo]) - Date.parse(day));
        if (anterior <= siguiente) return lo - 1;
      }
      return lo;
    };
    return transactions
      .filter((t) => t.assetId === assetId && (t.type === "buy" || t.type === "sell"))
      .map((t) => {
        const day = t.date.slice(0, 10);
        const i = cercano(day);
        if (i === null) return null;
        return {
          index: i,
          kind: t.type as "buy" | "sell",
          label: `${t.type === "buy" ? "Compra" : "Venta"} ${shortDate(day, true)}`,
        };
      })
      .filter((m): m is ReturnMark => m !== null);
  }, [series, transactions, assetId]);

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
          <ReturnChart data={history} height={120} level={nivelCosto} marks={marcas} />
          {nivelCosto && (
            <p className="label mt-2 leading-snug">
              La punteada es tu costo promedio: arriba de esa línea estás ganando.
              {marcas.length > 0 && " Los puntos son tus movimientos, llenos las compras y huecos las ventas."}
            </p>
          )}
        </div>
      )}

      {position.priceMissing && (
        <p className="mb-4 text-[12px]" style={{ color: "var(--color-warn)" }}>
          No hay cotización para {position.symbol}. Está valuada al costo. Revisá el
          símbolo del proveedor en Ajustes → Activos.
        </p>
      )}

      {/* Los cambios de ratio a la vista: si el proveedor informa uno, las
          unidades cambian solas, y eso no puede pasar sin que se vea por que. */}
      <div className="eyebrow mb-2">Cambios de ratio</div>
      <div className="card mb-4 p-3">
        {(portfolio.splits[position.assetId] ?? []).length > 0 ? (
          <ul className="mb-3 space-y-1">
            {portfolio.splits[position.assetId].map((s) => (
              <li key={`${s.source}-${s.date}`} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span>
                  {shortDate(s.date, true)}: cada unidad pasó a ser{" "}
                  <span className="num">{s.ratio.toLocaleString("es-AR", { maximumFractionDigits: 2 })}</span>
                </span>
                <span className="label shrink-0">
                  {s.source === "proveedor" ? "lo informó el proveedor" : "cargado por vos"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="label mb-3 leading-snug">
            Ninguno. Si tu broker te acreditó unidades por un cambio de ratio o un split,
            registralo: si no, la historia de precios del proveedor, que ya viene ajustada, no
            cierra con tus compras.
          </p>
        )}
        <button className="btn btn-sm w-full" onClick={() => setCargandoRatio(true)}>
          Registrar un cambio de ratio
        </button>
      </div>
      {cargandoRatio && (
        <SplitSheet assetId={position.assetId} onClose={() => setCargandoRatio(false)} />
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
