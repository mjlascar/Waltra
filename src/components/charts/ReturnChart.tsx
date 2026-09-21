"use client";

import { useMemo, useState } from "react";
import { percent, shortDate } from "@/lib/format";
import { areaPath, linear, linePath, niceTicks, padDomain, plotArea } from "./scale";
import { useMeasure } from "./useMeasure";

export interface ReturnPoint {
  day: string;
  value: number;
}

/**
 * Rendimiento acumulado (TWR). Una sola serie, asi que no lleva leyenda: el
 * titulo de la tarjeta ya dice que se esta graficando.
 */
export function ReturnChart({ data, height = 150 }: { data: ReturnPoint[]; height?: number }) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const box = { width, height, top: 10, right: 8, bottom: 20, left: 8 };
  const area = plotArea(box);

  const model = useMemo(() => {
    if (data.length === 0 || width === 0) return null;
    const values = data.map((p) => p.value);
    const [lo, hi] = padDomain(Math.min(0, ...values), Math.max(0, ...values), 0.12);
    const x = linear([0, Math.max(1, data.length - 1)], [area.x0, area.x1]);
    const y = linear([lo, hi], [area.y1, area.y0]);
    return {
      x,
      y,
      zero: y(0),
      ticks: niceTicks(lo, hi, 3).filter((t) => t >= lo && t <= hi),
      pts: data.map((p, i) => ({ x: x(i), y: y(p.value) })),
    };
  }, [data, width, area.x0, area.x1, area.y0, area.y1]);

  const last = data[data.length - 1]?.value ?? 0;
  const active = hover !== null ? data[hover] : null;
  // El signo del resultado ya distingue ganancia de perdida; el color refuerza.
  const tone = last >= 0 ? "var(--color-pos)" : "var(--color-neg)";

  return (
    <div ref={ref} className="w-full select-none">
      {model ? (
        <svg
          width={width}
          height={height}
          onPointerDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left - area.x0) / Math.max(1, area.w);
            setHover(Math.max(0, Math.min(data.length - 1, Math.round(ratio * (data.length - 1)))));
          }}
          onPointerMove={(e) => {
            if (e.buttons === 0 && e.pointerType !== "mouse") return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left - area.x0) / Math.max(1, area.w);
            setHover(Math.max(0, Math.min(data.length - 1, Math.round(ratio * (data.length - 1)))));
          }}
          onPointerLeave={() => setHover(null)}
          onPointerUp={() => setHover(null)}
        >
          {model.ticks.map((t) => (
            <line
              key={t}
              x1={area.x0}
              x2={area.x1}
              y1={model.y(t)}
              y2={model.y(t)}
              stroke={Math.abs(t) < 1e-9 ? "var(--color-line-strong)" : "var(--color-line)"}
              strokeWidth={1}
            />
          ))}
          <path d={areaPath(model.pts, model.zero)} fill={tone} opacity={0.1} />
          <path d={linePath(model.pts)} fill="none" stroke={tone} strokeWidth={2} strokeLinejoin="round" />
          {/* Etiquetas al final, sobre un recorte de la superficie. */}
          {model.ticks.map((t) => {
            const text = percent(t, { decimals: 0 });
            const w = text.length * 5.4 + 6;
            return (
              <g key={`label-${t}`}>
                <rect
                  x={area.x1 - w}
                  y={model.y(t) - 12}
                  width={w}
                  height={11}
                  fill="var(--color-surface)"
                />
                <text
                  x={area.x1 - 3}
                  y={model.y(t) - 3}
                  textAnchor="end"
                  className="num"
                  fontSize={9}
                  fill="var(--color-ink-3)"
                >
                  {text}
                </text>
              </g>
            );
          })}

          {hover !== null && data[hover] && (
            <g>
              <line
                x1={model.x(hover)}
                x2={model.x(hover)}
                y1={area.y0}
                y2={area.y1}
                stroke="var(--color-line-strong)"
              />
              <circle
                cx={model.x(hover)}
                cy={model.y(data[hover].value)}
                r={4}
                fill={tone}
                stroke="var(--color-surface)"
                strokeWidth={2}
              />
            </g>
          )}
          {[0, data.length - 1].map((i, idx) => (
            <text
              key={i}
              x={model.x(i)}
              y={height - 5}
              textAnchor={idx === 0 ? "start" : "end"}
              className="num"
              fontSize={9}
              fill="var(--color-ink-3)"
            >
              {shortDate(data[i].day, data.length > 300)}
            </text>
          ))}
        </svg>
      ) : (
        <div style={{ height }} className="flex items-center justify-center">
          <span className="label">Sin datos todavía</span>
        </div>
      )}
      {active && (
        <div className="mt-1 flex items-center justify-between">
          <span className="eyebrow">{shortDate(active.day, true)}</span>
          <span className="num text-[11px]" style={{ color: tone }}>
            {percent(active.value, { decimals: 1 })}
          </span>
        </div>
      )}
    </div>
  );
}
