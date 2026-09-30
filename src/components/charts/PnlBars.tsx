"use client";

import { useState } from "react";
import { money, percent } from "@/lib/format";
import type { Currency } from "@/lib/types";

export interface PnlRow {
  key: string;
  label: string;
  value: number;
  pct: number | null;
}

/**
 * Resultado por activo: barras divergentes desde un eje central.
 * La ganancia y la perdida ya se distinguen por el lado de la barra y por el
 * signo del numero; el color solo refuerza lo que ya esta dicho.
 */
/** Cuantas se ven de cada punta: primero 5, despues 10, despues todas. */
const PUNTAS = [5, 10];

/**
 * `fold`: las filas vienen ordenadas de mas ganancia a mas perdida y se
 * muestran las dos puntas, que son las que importan, con un boton en el
 * medio que va abriendo. La escala es la de todas las filas: que aparezca
 * una no cambia el largo de las otras.
 */
export function PnlBars({
  rows,
  currency = "USD",
  fold = false,
}: {
  rows: PnlRow[];
  currency?: Currency;
  fold?: boolean;
}) {
  const [nivel, setNivel] = useState(0);
  if (rows.length === 0) return <p className="label py-6 text-center">Sin resultados que mostrar.</p>;
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);

  const punta = PUNTAS[nivel];
  const plegar = fold && punta !== undefined && rows.length > punta * 2;
  if (!plegar) {
    return (
      <>
        <Filas rows={rows} max={max} currency={currency} />
        {fold && nivel > 0 && (
          <button className="chip mt-2" onClick={() => setNivel(0)}>
            Mostrar menos
          </button>
        )}
      </>
    );
  }
  return (
    <>
      <Filas rows={rows.slice(0, punta)} max={max} currency={currency} />
      <div className="hairline flex justify-center py-2">
        <button className="chip" onClick={() => setNivel(nivel + 1)}>
          {PUNTAS[nivel + 1] !== undefined && rows.length > PUNTAS[nivel + 1] * 2
            ? "Mostrar más activos"
            : "Mostrar todos"}
        </button>
      </div>
      <Filas rows={rows.slice(-punta)} max={max} currency={currency} />
    </>
  );
}

function Filas({ rows, max, currency }: { rows: PnlRow[]; max: number; currency: Currency }) {
  return (
    <ul className="divide-hairline">
      {rows.map((row) => {
        const ratio = Math.abs(row.value) / max;
        const positive = row.value >= 0;
        return (
          <li key={row.key} className="py-2.5">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="truncate text-[13px] font-medium">{row.label}</span>
              <span className="flex items-baseline gap-2">
                <span className={`num text-[12px] ${positive ? "pos" : "neg"}`}>
                  {money(row.value, currency, { compact: true, sign: true })}
                </span>
                <span className="num w-12 text-right text-[11px]" style={{ color: "var(--color-ink-3)" }}>
                  {percent(row.pct, { decimals: 0 })}
                </span>
              </span>
            </div>
            {/* Eje al centro: a la izquierda las perdidas, a la derecha las ganancias. */}
            <div className="relative h-1.5 w-full" style={{ background: "var(--color-surface-2)" }}>
              <div className="absolute inset-y-0 left-1/2 w-px" style={{ background: "var(--color-line-strong)" }} />
              <div
                className="absolute inset-y-0"
                style={{
                  background: positive ? "var(--color-pos)" : "var(--color-neg)",
                  width: `${Math.max(1, ratio * 50)}%`,
                  left: positive ? "50%" : undefined,
                  right: positive ? undefined : "50%",
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
