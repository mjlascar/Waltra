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
import { MiniSegmented } from "@/components/ui/Field";
import { IconChevron } from "@/components/icons";
import { rangeStart } from "@/lib/date";

type Rango = "3M" | "6M" | "1A" | "MAX";

const RANGOS: { value: Rango; label: string }[] = [
  { value: "3M", label: "3M" },
  { value: "6M", label: "6M" },
  { value: "1A", label: "1A" },
  { value: "MAX", label: "Todo" },
];

/** Detalle de una posicion: de donde viene el resultado y con que movimientos. */
export function PositionSheet({
  position,
  onClose,
}: {
  position: PositionView | null;
  onClose: () => void;
}) {
  const { transactions, accounts, assets, portfolio } = useStore();
  const display = portfolio.base;
  const [cargandoRatio, setCargandoRatio] = useState(false);
  const db = getDb();
  const assetId = position?.assetId;

  const series = useLiveQuery(
    async () => (db && assetId ? db.priceSeries.get(assetId) : undefined),
    [db, assetId],
  );

  const [rango, setRango] = useState<Rango>("MAX");
  const [elegida, setElegida] = useState<string | null>(null);

  /** Los cierres de la ventana elegida. */
  const puntos = useMemo(() => {
    const todos = series?.points ?? [];
    if (todos.length === 0 || rango === "MAX") return todos;
    const desde = rangeStart(rango, todos[0].date, todos[todos.length - 1].date);
    return todos.filter((p) => p.date >= desde);
  }, [series, rango]);

  // Indexada al primer cierre de la ventana: 3M dice lo que paso en esos tres
  // meses, no el acumulado desde siempre recortado.
  const history = useMemo(() => {
    const base = puntos[0]?.close;
    if (!base) return [];
    return puntos.map((p) => ({ day: p.date, value: p.close / base - 1 }));
  }, [puntos]);

  /**
   * El costo promedio, en las mismas unidades que la curva: arriba de esa
   * linea la posicion esta en ganancia y abajo en perdida. La linea va donde
   * cae el costo contra la curva, en la moneda del activo; el rotulo, en la
   * moneda en que se ve la app, como el resto de la hoja.
   */
  const avgCost = position?.avgCost;
  const costoVisto = position?.avgCostUsd;
  const nivelCosto = useMemo(() => {
    const base = puntos[0]?.close;
    if (!base || !avgCost || costoVisto === undefined) return undefined;
    return {
      value: avgCost / base - 1,
      label: money(costoVisto, display, { compact: true }),
    };
  }, [puntos, avgCost, costoVisto, display]);

  /**
   * Cada compra y cada venta de la ventana, ubicadas en el dia que pasaron.
   *
   * Si operaste un dia sin cotizacion —un feriado, un fin de semana en una
   * accion— la marca se corre al dia habil mas cercano en vez de perderse:
   * descartarla en silencio dejaria el grafico diciendo que compraste menos
   * veces de las que compraste.
   */
  const operaciones = useMemo(() => {
    if (!puntos.length || !assetId) return [];
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
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map((tx) => {
        const index = cercano(tx.date.slice(0, 10));
        return index === null ? null : { tx, index };
      })
      .filter((o): o is { tx: (typeof transactions)[number]; index: number } => o !== null);
  }, [puntos, transactions, assetId]);

  const marcas = useMemo(
    (): ReturnMark[] =>
      operaciones.map(({ tx, index }) => ({
        index,
        kind: tx.type as "buy" | "sell",
        label: `${tx.type === "buy" ? "Compra" : "Venta"} ${shortDate(tx.date.slice(0, 10), true)}`,
      })),
    [operaciones],
  );

  // La que se mira en el navegador. Si quedo afuera de la ventana (se cambio
  // el rango), la ultima de las que se ven.
  const hallada = operaciones.findIndex((o) => o.tx.id === elegida);
  const posElegida = hallada >= 0 ? hallada : operaciones.length - 1;
  const actual = posElegida >= 0 ? operaciones[posElegida] : null;

  const moves = useMemo(
    () =>
      transactions
        .filter((t) => t.assetId === assetId)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [transactions, assetId],
  );

  if (!position) return null;
  const asset = assets.find((a) => a.id === position.assetId);
  const splitsActivo = portfolio.splits[position.assetId] ?? [];

  return (
    <Sheet open onClose={onClose} title={position.symbol}>
      <div className="mb-4">
        <div className="eyebrow mb-1.5">
          {position.name} · {KIND_LABEL[position.kind] ?? position.kind}
        </div>
        <div className="num text-[26px] leading-none">{money(position.valueUsd, display)}</div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className={`num text-[13px] ${position.unrealizedUsd >= 0 ? "pos" : "neg"}`}>
            {money(position.unrealizedUsd, display, { sign: true })}
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
          ["Precio actual", position.priceUsd === null ? "sin dato" : money(position.priceUsd, display)],
          ["Costo promedio", money(position.avgCostUsd, display)],
          ["Invertido", money(position.costUsd, display)],
          ["Peso en cartera", percent(position.weight, { decimals: 1, sign: false })],
          [
            "Realizado",
            position.realizedUsd === 0 ? "—" : money(position.realizedUsd, display, { sign: true }),
          ],
        ].map(([label, value]) => (
          <div key={label} style={{ background: "var(--color-surface)" }} className="p-3">
            <div className="eyebrow mb-1.5">{label}</div>
            <div className="num text-[13px]">{value}</div>
          </div>
        ))}
      </div>

      {(series?.points.length ?? 0) > 2 && (
        <div className="card mb-4 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="eyebrow">Histórico</span>
            <MiniSegmented
              value={rango}
              onChange={setRango}
              label="Rango del histórico"
              options={RANGOS}
            />
          </div>
          <ReturnChart
            key={rango}
            data={history}
            height={130}
            level={nivelCosto}
            marks={marcas}
            axisOutside
            focus={actual?.index ?? null}
          />
          {/* Un navegador entre las operaciones de la ventana: la marca que se
              mira se resalta en el grafico, y aca van el precio y la cantidad
              que en el grafico no entran. */}
          {actual ? (
            <div className="hairline mt-2 flex items-center gap-2 pt-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="chip shrink-0">{TX_SHORT[actual.tx.type]}</span>
                  <span className="label num">{shortDate(actual.tx.date.slice(0, 10), true)}</span>
                </div>
                <div className="num mt-1 truncate text-[12px]">
                  {fmtQty(actual.tx.quantity ?? 0, asset?.precision ?? 6)} a{" "}
                  {money(
                    (actual.tx.price ?? actual.tx.amount / (actual.tx.quantity || 1)) *
                      (asset?.priceUnit ?? 1),
                    actual.tx.currency,
                  )}
                  {(asset?.priceUnit ?? 1) > 1 && " cada 100 VN"}
                </div>
              </div>
              <span className="label num shrink-0">
                {posElegida + 1}/{operaciones.length}
              </span>
              <button
                type="button"
                className="btn btn-sm px-2"
                aria-label="Operación anterior"
                disabled={posElegida <= 0}
                onClick={() => setElegida(operaciones[posElegida - 1].tx.id)}
              >
                <IconChevron size={14} className="rotate-180" />
              </button>
              <button
                type="button"
                className="btn btn-sm px-2"
                aria-label="Operación siguiente"
                disabled={posElegida >= operaciones.length - 1}
                onClick={() => setElegida(operaciones[posElegida + 1].tx.id)}
              >
                <IconChevron size={14} />
              </button>
            </div>
          ) : (
            <p className="label hairline mt-2 pt-2">Sin compras ni ventas en este período.</p>
          )}
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
      {/* Los cambios de ratio a la vista: si el proveedor informa uno, las
          unidades cambian solas, y eso no puede pasar sin que se vea por que.
          La cripto no se divide. */}
      {position.kind !== "crypto" && (
        <p className="label mt-4 leading-snug">
          {splitsActivo.length > 0
            ? `Cambios de ratio: ${splitsActivo
                .map(
                  (s) =>
                    `×${s.ratio.toLocaleString("es-AR", { maximumFractionDigits: 2 })} el ${shortDate(s.date, true)}${s.source === "proveedor" ? " (proveedor)" : ""}`,
                )
                .join(", ")}. `
            : "Sin cambios de ratio. "}
          <button className="underline" onClick={() => setCargandoRatio(true)}>
            Registrar uno
          </button>
        </p>
      )}
      {cargandoRatio && (
        <SplitSheet assetId={position.assetId} onClose={() => setCargandoRatio(false)} />
      )}
    </Sheet>
  );
}
