"use client";

import { money, percent } from "@/lib/format";

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
export function PnlBars({ rows }: { rows: PnlRow[] }) {
  if (rows.length === 0) return <p className="label py-6 text-center">Sin resultados que mostrar.</p>;
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);

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
                  {money(row.value, "USD", { compact: true, sign: true })}
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
