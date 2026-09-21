"use client";

import { linear, linePath } from "./scale";

/** Mini linea de contexto para una fila de la tabla. Sin ejes ni etiquetas. */
export function Sparkline({
  values,
  width = 56,
  height = 20,
  tone,
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: string;
}) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = linear([0, values.length - 1], [1, width - 1]);
  const y = linear([min, max], [height - 2, 2]);
  const color = tone ?? (values[values.length - 1] >= values[0] ? "var(--color-pos)" : "var(--color-neg)");
  return (
    <svg width={width} height={height} aria-hidden>
      <path
        d={linePath(values.map((v, i) => ({ x: x(i), y: y(v) })))}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
