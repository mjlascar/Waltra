"use client";

import { useMemo, useState } from "react";
import { percent, shortDate } from "@/lib/format";
import { areaPath, linear, linePath, niceTicks, padDomain, plotArea } from "./scale";
import { useMeasure } from "./useMeasure";

export interface ReturnPoint {
  day: string;
  value: number;
}

export interface ReturnSeries {
  label: string;
  color: string;
  points: ReturnPoint[];
  /** La serie principal lleva relleno; la de referencia va solo con linea. */
  fill?: boolean;
}

/**
 * Rendimiento acumulado, en tanto por uno.
 *
 * Con una sola serie no lleva leyenda: el titulo de la tarjeta ya dice que se
 * esta graficando. Con dos (cartera contra indice de referencia) la leyenda es
 * obligatoria, porque la identidad nunca puede depender solo del color.
 */
export function ReturnChart({
  data,
  compare,
  height = 150,
  tone,
}: {
  data: ReturnPoint[];
  compare?: ReturnSeries;
  height?: number;
  tone?: string;
}) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const box = { width, height, top: 10, right: 8, bottom: 20, left: 8 };
  const area = plotArea(box);

  const last = data[data.length - 1]?.value ?? 0;
  // El signo del resultado ya distingue ganancia de perdida; el color refuerza.
  const mainColor = tone ?? (last >= 0 ? "var(--color-pos)" : "var(--color-neg)");

  const model = useMemo(() => {
    // Con menos de dos puntos no hay curva que dibujar.
    if (data.length < 2 || width === 0) return null;
    const values = data.map((p) => p.value);
    if (compare) values.push(...compare.points.map((p) => p.value));
    const [lo, hi] = padDomain(Math.min(0, ...values), Math.max(0, ...values), 0.12);
    const x = linear([0, Math.max(1, data.length - 1)], [area.x0, area.x1]);
    const y = linear([lo, hi], [area.y1, area.y0]);
    return {
      x,
      y,
      zero: y(0),
      ticks: niceTicks(lo, hi, 3).filter((t) => t >= lo && t <= hi),
      pts: data.map((p, i) => ({ x: x(i), y: y(p.value) })),
      comparePts: compare?.points.map((p, i) => ({ x: x(i), y: y(p.value) })) ?? null,
    };
  }, [data, compare, width, area.x0, area.x1, area.y0, area.y1]);

  const active = hover !== null ? data[hover] : null;
  const activeCompare = hover !== null ? compare?.points[hover] : null;

  function pick(clientX: number, rect: DOMRect) {
    const ratio = (clientX - rect.left - area.x0) / Math.max(1, area.w);
    setHover(Math.max(0, Math.min(data.length - 1, Math.round(ratio * (data.length - 1)))));
  }

  return (
    <div ref={ref} className="w-full select-none">
      {compare && (
        <div className="mb-2 flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="swatch" style={{ background: mainColor }} />
            <span className="label">Tu cartera</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="swatch" style={{ background: compare.color }} />
            <span className="label">{compare.label}</span>
          </span>
        </div>
      )}

      {model ? (
        <svg
          width={width}
          height={height}
          // Horizontal es de la cruceta, vertical sigue siendo scroll de la
          // pagina. Sin esto el navegador puede quedarse con las dos.
          className="touch-pan-y"
          // Ver el comentario en ValueChart: la captura del puntero es lo que
          // evita que la cruceta se cuelgue al arrastrar hasta el borde.
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            pick(e.clientX, e.currentTarget.getBoundingClientRect());
          }}
          onPointerMove={(e) => {
            if (e.buttons === 0 && e.pointerType !== "mouse") return;
            pick(e.clientX, e.currentTarget.getBoundingClientRect());
          }}
          onPointerUp={() => setHover(null)}
          onPointerCancel={() => setHover(null)}
          onLostPointerCapture={() => setHover(null)}
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

          <path d={areaPath(model.pts, model.zero)} fill={mainColor} opacity={0.1} />
          {model.comparePts && (
            <path
              d={linePath(model.comparePts)}
              fill="none"
              stroke={compare!.color}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          )}
          <path
            d={linePath(model.pts)}
            fill="none"
            stroke={mainColor}
            strokeWidth={2}
            strokeLinejoin="round"
          />

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
              {model.comparePts?.[hover] && (
                <circle
                  cx={model.comparePts[hover].x}
                  cy={model.comparePts[hover].y}
                  r={4}
                  fill={compare!.color}
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                />
              )}
              <circle
                cx={model.x(hover)}
                cy={model.y(data[hover].value)}
                r={4}
                fill={mainColor}
                stroke="var(--color-surface)"
                strokeWidth={2}
              />
            </g>
          )}

          {[...new Set([0, data.length - 1])].map((i, idx, all) => (
            <text
              key={i}
              x={model.x(i)}
              y={height - 5}
              textAnchor={all.length === 1 ? "middle" : idx === 0 ? "start" : "end"}
              className="num"
              fontSize={9}
              fill="var(--color-ink-3)"
            >
              {shortDate(data[i].day, data.length > 300)}
            </text>
          ))}
        </svg>
      ) : (
        <div style={{ height }} className="flex items-center justify-center px-6 text-center">
          <span className="label">
            {data.length === 1
              ? "Con un solo día cargado todavía no hay rendimiento que medir."
              : "Sin datos en este período."}
          </span>
        </div>
      )}

      {active && (
        <div className="mt-1 flex items-center justify-between">
          <span className="eyebrow">{shortDate(active.day, true)}</span>
          <span className="flex items-baseline gap-3">
            <span className="num text-[11px]" style={{ color: mainColor }}>
              {percent(active.value, { decimals: 1 })}
            </span>
            {activeCompare && (
              <span className="num text-[11px]" style={{ color: compare!.color }}>
                {percent(activeCompare.value, { decimals: 1 })}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
