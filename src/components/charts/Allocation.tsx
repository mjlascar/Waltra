"use client";

import { money, percent } from "@/lib/format";

export interface Slice {
  key: string;
  label: string;
  value: number;
  sub?: string;
}

/** Orden fijo de la paleta: el color sigue a la entidad, nunca al ranking. */
const SERIES = [
  "var(--color-s1)",
  "var(--color-s2)",
  "var(--color-s3)",
  "var(--color-s4)",
  "var(--color-s5)",
];
const REST = "var(--color-ink-3)";

/**
 * Composicion de la cartera: barra apilada + lista etiquetada.
 *
 * En 360px de ancho una torta con seis porciones es ilegible. La barra dice
 * la proporcion de un vistazo y la lista da el numero exacto; cada tramo
 * queda identificado por texto, asi que el color nunca es el unico canal.
 */
export function Allocation({ slices, total }: { slices: Slice[]; total: number }) {
  if (slices.length === 0 || total <= 0) {
    return <p className="label py-6 text-center">Todavía no hay posiciones.</p>;
  }

  const sorted = [...slices].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, 5);
  const tail = sorted.slice(5);
  const rows = tail.length
    ? [
        ...head,
        {
          key: "__rest",
          label: `Otros (${tail.length})`,
          value: tail.reduce((s, x) => s + x.value, 0),
        },
      ]
    : head;

  const colorOf = (index: number) => (index < SERIES.length ? SERIES[index] : REST);

  return (
    <div>
      <div className="flex h-7 w-full overflow-hidden" style={{ gap: 2 }}>
        {rows.map((row, i) => (
          <div
            key={row.key}
            style={{
              background: colorOf(i),
              width: `${Math.max(0.5, (row.value / total) * 100)}%`,
            }}
            title={`${row.label} · ${percent(row.value / total)}`}
          />
        ))}
      </div>

      <ul className="mt-3 divide-hairline">
        {rows.map((row, i) => (
          <li key={row.key} className="flex items-center gap-2.5 py-2">
            <span className="swatch" style={{ background: colorOf(i) }} />
            <span className="min-w-0 flex-1 truncate text-[13px]">{row.label}</span>
            {row.sub && <span className="label shrink-0">{row.sub}</span>}
            <span className="num shrink-0 text-[12px]" style={{ color: "var(--color-ink-2)" }}>
              {money(row.value, "USD", { compact: true })}
            </span>
            <span className="num w-11 shrink-0 text-right text-[12px]">
              {percent(row.value / total, { decimals: 0, sign: false })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
