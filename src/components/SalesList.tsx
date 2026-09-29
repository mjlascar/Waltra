"use client";

import { useMemo, useState } from "react";
import { SectionTitle } from "@/components/ui/Stat";
import { money, percent, quantity as fmtQty, shortDate } from "@/lib/format";
import { daysBetween } from "@/lib/date";
import type { Portfolio } from "@/lib/engine/portfolio";

/** Cuantas se ven antes de tocar "Ver todas". */
const VISIBLES = 6;

function plazo(dias: number): string {
  if (dias < 1) return "unas horas";
  if (dias < 60) return `${dias} ${dias === 1 ? "día" : "días"}`;
  const meses = Math.round(dias / 30.4);
  if (meses < 24) return `${meses} meses`;
  return `${(dias / 365).toLocaleString("es-AR", { maximumFractionDigits: 1 })} años`;
}

/**
 * Cada venta con lo que dejo: la pregunta "¿vendi bien NIO?" no la contesta el
 * realizado total, que mezcla todas. Con costo promedio no hay una compra
 * puntual que empareje a cada venta: el costo es el de todo lo que se tenia, y
 * el plazo se cuenta desde que se abrio la posicion. Se dice asi abajo.
 */
export function SalesList({ portfolio: p }: { portfolio: Portfolio }) {
  const [todas, setTodas] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);
  const display = p.base;

  const filas = useMemo(() => {
    const simbolo = new Map<string, string>();
    for (const pos of p.positions) simbolo.set(pos.assetId, pos.symbol);
    for (const pos of p.closedPositions) simbolo.set(pos.assetId, pos.symbol);
    return [...p.sales]
      .reverse()
      .map((s) => ({ ...s, symbol: simbolo.get(s.assetId) ?? s.assetId }));
  }, [p.sales, p.positions, p.closedPositions]);

  if (filas.length === 0) return null;
  const ganadoras = filas.filter((f) => f.pnl > 0).length;
  const total = filas.reduce((acc, f) => acc + f.pnl, 0);
  const vistas = todas ? filas : filas.slice(0, VISIBLES);

  return (
    <section className="mb-5">
      <SectionTitle>Cómo te fue en cada venta</SectionTitle>
      <div className="card divide-hairline">
        <div className="flex items-baseline justify-between gap-3 p-3">
          <span className="label">
            {filas.length} {filas.length === 1 ? "venta" : "ventas"} · {ganadoras} con ganancia
          </span>
          <span className={`num text-[13px] ${total >= 0 ? "pos" : "neg"}`}>
            {money(total, display, { compact: true, sign: true })}
          </span>
        </div>
        {vistas.map((f) => {
          const pct = f.cost > 0 ? f.pnl / f.cost : null;
          const tono = f.pnl >= 0 ? "pos" : "neg";
          const dias = f.since ? daysBetween(f.since, f.day) : null;
          const expandida = abierta === f.txId;
          return (
            <button
              key={f.txId}
              type="button"
              className="block w-full p-3 text-left"
              aria-expanded={expandida}
              onClick={() => setAbierta(expandida ? null : f.txId)}
            >
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium">{f.symbol}</div>
                  <div className="label num">
                    {shortDate(f.day, true)} · {fmtQty(f.quantity, 4)}
                    {dias !== null && ` · tras ${plazo(dias)}`}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`num text-[13px] ${tono}`}>
                    {money(f.pnl, display, { compact: true, sign: true })}
                  </div>
                  <div className={`num text-[11px] ${pct === null ? "" : tono}`}>
                    {pct === null ? "sin costo" : `(${percent(pct, { decimals: 1 })})`}
                  </div>
                </div>
              </div>
              {expandida && (
                <p className="label mt-2 leading-snug">
                  Cobraste {money(f.proceeds, display)}, neto de comisión. Te habían costado{" "}
                  {money(f.cost, display)} al costo promedio de lo que tenías.
                  {f.uncovered > 1e-9 &&
                    ` ${fmtQty(f.uncovered, 4)} no figuraban compradas: salieron sin costo y ese resultado está inflado hasta que cargues de dónde vinieron.`}
                </p>
              )}
            </button>
          );
        })}
      </div>
      {filas.length > VISIBLES && (
        <button className="chip mt-2" onClick={() => setTodas(!todas)}>
          {todas ? "Ver menos" : `Ver las ${filas.length}`}
        </button>
      )}
      <p className="label mt-2 leading-snug">
        Cada venta contra el costo promedio de lo que tenías de ese activo, que es como lo
        cuenta tu broker. Tocá una para ver el detalle.
      </p>
    </section>
  );
}
