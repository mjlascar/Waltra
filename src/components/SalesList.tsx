"use client";

import { useMemo, useState } from "react";
import { SectionTitle } from "@/components/ui/Stat";
import { MiniSegmented } from "@/components/ui/Field";
import { IconChevron } from "@/components/icons";
import { money, percent, quantity as fmtQty, shortDate } from "@/lib/format";
import { daysBetween } from "@/lib/date";
import type { Portfolio } from "@/lib/engine/portfolio";
import type { Sale } from "@/lib/engine/ledger";

/** Cuantas se ven antes de tocar "Ver todas". */
const VISIBLES = 6;

type Orden = "recientes" | "ganancia" | "perdida";

type Fila = Sale & { symbol: string };

function plazo(dias: number): string {
  if (dias < 1) return "unas horas";
  if (dias < 60) return `${dias} ${dias === 1 ? "día" : "días"}`;
  const meses = Math.round(dias / 30.4);
  if (meses < 24) return `${meses} meses`;
  return `${(dias / 365).toLocaleString("es-AR", { maximumFractionDigits: 1 })} años`;
}

/** Recientes es el orden del ledger al reves; los otros, por el resultado en plata. */
function ordenar<T>(items: T[], orden: Orden, pnl: (x: T) => number): T[] {
  if (orden === "recientes") return items;
  const signo = orden === "ganancia" ? -1 : 1;
  return [...items].sort((a, b) => signo * (pnl(a) - pnl(b)));
}

/**
 * Cada venta con lo que dejo: la pregunta "¿vendi bien NIO?" no la contesta el
 * realizado total, que mezcla todas. Con costo promedio no hay una compra
 * puntual que empareje a cada venta: el costo es el de todo lo que se tenia, y
 * el plazo se cuenta desde que se abrio la posicion.
 *
 * Agrupadas por activo contestan la otra pregunta: como me fue, en total, con
 * todo lo que vendi de bitcoin.
 */
export function SalesList({ portfolio: p }: { portfolio: Portfolio }) {
  const [todas, setTodas] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [orden, setOrden] = useState<Orden>("recientes");
  const [agrupar, setAgrupar] = useState(false);
  /**
   * Los activos abiertos, cuando se agrupa. Arrancan todos cerrados: abiertos,
   * la lista era tan larga como sin agrupar y agrupar no servia para mirar de
   * un vistazo como le fue a cada uno.
   */
  const [desplegados, setDesplegados] = useState<Set<string>>(() => new Set());
  const display = p.base;

  const filas = useMemo<Fila[]>(() => {
    const simbolo = new Map<string, string>();
    for (const pos of p.positions) simbolo.set(pos.assetId, pos.symbol);
    for (const pos of p.closedPositions) simbolo.set(pos.assetId, pos.symbol);
    return [...p.sales]
      .reverse()
      .map((s) => ({ ...s, symbol: simbolo.get(s.assetId) ?? s.assetId }));
  }, [p.sales, p.positions, p.closedPositions]);

  const grupos = useMemo(() => {
    const porActivo = new Map<string, Fila[]>();
    for (const f of filas) porActivo.set(f.assetId, [...(porActivo.get(f.assetId) ?? []), f]);
    const lista = [...porActivo.values()].map((ventas) => {
      const pnl = ventas.reduce((acc, v) => acc + v.pnl, 0);
      const costo = ventas.reduce((acc, v) => acc + v.cost, 0);
      return {
        assetId: ventas[0].assetId,
        symbol: ventas[0].symbol,
        pnl,
        pct: costo > 0 ? pnl / costo : null,
        ventas: ordenar(ventas, orden, (v) => v.pnl),
      };
    });
    return ordenar(lista, orden, (g) => g.pnl);
  }, [filas, orden]);

  if (filas.length === 0) return null;
  const ganadoras = filas.filter((f) => f.pnl > 0).length;
  const total = filas.reduce((acc, f) => acc + f.pnl, 0);
  const ordenadas = ordenar(filas, orden, (f) => f.pnl);
  const vistas = todas ? ordenadas : ordenadas.slice(0, VISIBLES);
  const gruposVistos = todas ? grupos : grupos.slice(0, VISIBLES);
  const cuantos = agrupar ? grupos.length : filas.length;

  const venta = (f: Fila, conSimbolo: boolean) => {
    const pct = f.cost > 0 ? f.pnl / f.cost : null;
    const tono = f.pnl >= 0 ? "pos" : "neg";
    const dias = f.since ? daysBetween(f.since, f.day) : null;
    const expandida = abierta === f.txId;
    return (
      <button
        key={f.txId}
        type="button"
        className={`block w-full text-left ${conSimbolo ? "p-3" : "py-2 pl-6 pr-3"}`}
        aria-expanded={expandida}
        onClick={() => setAbierta(expandida ? null : f.txId)}
      >
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            {conSimbolo && <div className="text-[14px] font-medium">{f.symbol}</div>}
            <div className="label num">
              {shortDate(f.day, true)}
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
            Vendiste {fmtQty(f.quantity, 6)} y cobraste {money(f.proceeds, display)}, neto de
            comisión. Te habían costado {money(f.cost, display)}.
            {f.uncovered > 1e-9 &&
              ` ${fmtQty(f.uncovered, 4)} no figuraban compradas: salieron sin costo y ese resultado está inflado hasta que cargues de dónde vinieron.`}
          </p>
        )}
      </button>
    );
  };

  return (
    <section className="mb-5">
      <SectionTitle>Resultado realizado</SectionTitle>
      <div className="mb-2 flex items-center justify-between gap-2">
        <MiniSegmented
          value={orden}
          onChange={setOrden}
          label="Ordenar ventas"
          options={[
            { value: "recientes", label: "Recientes" },
            { value: "ganancia", label: "Ganancia" },
            { value: "perdida", label: "Pérdida" },
          ]}
        />
        {/* Un interruptor y no otro selector: los dos no entraban en el
            ancho de un telefono. */}
        <button
          type="button"
          aria-pressed={agrupar}
          onClick={() => setAgrupar(!agrupar)}
          className="num shrink-0 border px-2 py-[3px] text-[11px]"
          style={
            agrupar
              ? { background: "var(--color-ink)", color: "var(--color-bg)", borderColor: "var(--color-ink)" }
              : { color: "var(--color-ink-3)", borderColor: "var(--color-line)" }
          }
        >
          Por activo
        </button>
      </div>
      <div className="card divide-hairline">
        <div className="flex items-baseline justify-between gap-3 p-3">
          <span className="label">
            {filas.length} {filas.length === 1 ? "venta" : "ventas"} · {ganadoras} con ganancia
          </span>
          <span className={`num text-[13px] ${total >= 0 ? "pos" : "neg"}`}>
            {money(total, display, { compact: true, sign: true })}
          </span>
        </div>
        {agrupar
          ? gruposVistos.map((g) => {
              const tono = g.pnl >= 0 ? "pos" : "neg";
              return (
                <div key={g.assetId}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 p-3 text-left"
                    aria-expanded={desplegados.has(g.assetId)}
                    onClick={() =>
                      setDesplegados((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.assetId)) next.delete(g.assetId);
                        else next.add(g.assetId);
                        return next;
                      })
                    }
                  >
                    <IconChevron
                      size={12}
                      className={`shrink-0 transition-transform ${desplegados.has(g.assetId) ? "rotate-90" : ""}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-medium">{g.symbol}</div>
                      <div className="label">
                        {g.ventas.length} {g.ventas.length === 1 ? "venta" : "ventas"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`num text-[13px] ${tono}`}>
                        {money(g.pnl, display, { compact: true, sign: true })}
                      </div>
                      <div className={`num text-[11px] ${g.pct === null ? "" : tono}`}>
                        {g.pct === null ? "sin costo" : `(${percent(g.pct, { decimals: 1 })})`}
                      </div>
                    </div>
                  </button>
                  {desplegados.has(g.assetId) && g.ventas.map((v) => venta(v, false))}
                </div>
              );
            })
          : vistas.map((f) => venta(f, true))}
      </div>
      {cuantos > VISIBLES && (
        <button className="chip mt-2" onClick={() => setTodas(!todas)}>
          {todas ? "Ver menos" : `Ver ${agrupar ? "los" : "las"} ${cuantos}`}
        </button>
      )}
      <p className="label mt-2 leading-snug">
        Cada venta contra el costo promedio de lo que tenías de ese activo. Tocá para ver su
        detalle.
      </p>
    </section>
  );
}
