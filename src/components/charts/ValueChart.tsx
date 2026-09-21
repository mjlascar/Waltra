"use client";

import { useMemo, useState } from "react";
import { money, shortDate } from "@/lib/format";
import { areaPath, linear, linePath, niceTicks, padDomain, plotArea, stepPath } from "./scale";
import { useMeasure } from "./useMeasure";

export interface ValuePoint {
  day: string;
  value: number;
  contributed: number;
}

/**
 * El grafico central de Waltra: el valor de la cartera contra el capital que
 * pusiste. La distancia entre las dos lineas es, literalmente, lo que ganaste
 * o perdiste. Es la vista que los brokers no dan y que motivo toda la app.
 */
export function ValueChart({ data, height = 210 }: { data: ValuePoint[]; height?: number }) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const box = { width, height, top: 12, right: 8, bottom: 22, left: 8 };
  const area = plotArea(box);

  const model = useMemo(() => {
    if (data.length === 0 || width === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const p of data) {
      min = Math.min(min, p.value, p.contributed);
      max = Math.max(max, p.value, p.contributed);
    }
    if (min === Infinity) return null;
    // El eje arranca en cero salvo que la cartera haya sido negativa.
    const [lo, hi] = padDomain(Math.min(0, min), max, 0.1);
    const x = linear([0, Math.max(1, data.length - 1)], [area.x0, area.x1]);
    const y = linear([lo, hi], [area.y1, area.y0]);
    return {
      x,
      y,
      ticks: niceTicks(lo, hi, 3).filter((t) => t >= lo && t <= hi),
      valuePts: data.map((p, i) => ({ x: x(i), y: y(p.value) })),
      capitalPts: data.map((p, i) => ({ x: x(i), y: y(p.contributed) })),
    };
  }, [data, width, area.x0, area.x1, area.y0, area.y1]);

  const active = hover !== null ? data[Math.min(hover, data.length - 1)] : data[data.length - 1];
  const gain = active ? active.value - active.contributed : 0;

  function pick(clientX: number, rect: DOMRect) {
    if (data.length === 0) return;
    const ratio = (clientX - rect.left - area.x0) / Math.max(1, area.w);
    const index = Math.round(ratio * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, index)));
  }

  return (
    <div ref={ref} className="w-full select-none">
      {/* Leyenda: con dos series siempre esta presente, nunca color solo. */}
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="swatch" style={{ background: "var(--color-s1)" }} />
              <span className="label">Valor</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="swatch" style={{ background: "var(--color-s4)" }} />
              <span className="label">Capital aportado</span>
            </span>
          </div>
        </div>
        {active && (
          <div className="text-right">
            <div className="num text-[13px] leading-tight">{money(active.value, "USD", { compact: true })}</div>
            <div className={`num text-[11px] leading-tight ${gain >= 0 ? "pos" : "neg"}`}>
              {money(gain, "USD", { compact: true, sign: true })}
            </div>
          </div>
        )}
      </div>

      {model ? (
        <svg
          width={width}
          height={height}
          className="touch-pan-y"
          onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerMove={(e) => {
            if (e.buttons > 0 || e.pointerType === "mouse") {
              pick(e.clientX, e.currentTarget.getBoundingClientRect());
            }
          }}
          onPointerLeave={() => setHover(null)}
          onPointerUp={() => setHover(null)}
        >
          {/* Grilla: hairline solida, un paso por encima de la superficie. */}
          {model.ticks.map((t) => (
            <line
              key={t}
              x1={area.x0}
              x2={area.x1}
              y1={model.y(t)}
              y2={model.y(t)}
              stroke="var(--color-line)"
              strokeWidth={1}
            />
          ))}

          <path
            d={areaPath(model.valuePts, area.y1)}
            fill="var(--color-s1)"
            opacity={0.1}
          />
          <path
            d={stepPath(model.capitalPts)}
            fill="none"
            stroke="var(--color-s4)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <path
            d={linePath(model.valuePts)}
            fill="none"
            stroke="var(--color-s1)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Las etiquetas del eje van al final, sobre un recorte de la
              superficie: dibujadas antes, la linea de datos las cruza y no se
              lee ninguna de las dos. */}
          {model.ticks.map((t) => {
            const text = money(t, "USD", { compact: true, decimals: 0 });
            const w = text.length * 5.4 + 6;
            return (
              <g key={`label-${t}`}>
                <rect
                  x={area.x1 - w}
                  y={model.y(t) - 13}
                  width={w}
                  height={12}
                  fill="var(--color-surface)"
                />
                <text
                  x={area.x1 - 3}
                  y={model.y(t) - 4}
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
                strokeWidth={1}
              />
              {/* Anillo del color de la superficie para que el punto se lea
                  incluso cuando las dos lineas se cruzan. */}
              <circle cx={model.x(hover)} cy={model.y(data[hover].contributed)} r={4}
                fill="var(--color-s4)" stroke="var(--color-surface)" strokeWidth={2} />
              <circle cx={model.x(hover)} cy={model.y(data[hover].value)} r={4}
                fill="var(--color-s1)" stroke="var(--color-surface)" strokeWidth={2} />
            </g>
          )}

          {/* Eje temporal: tres marcas alcanzan en un telefono. */}
          {[0, Math.floor((data.length - 1) / 2), data.length - 1].map((i, idx) => (
            <text
              key={i}
              x={model.x(i)}
              y={height - 6}
              textAnchor={idx === 0 ? "start" : idx === 2 ? "end" : "middle"}
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

      {hover !== null && data[hover] && (
        <div className="mt-1 flex items-center justify-between">
          <span className="eyebrow">{shortDate(data[hover].day, true)}</span>
          <span className="num text-[11px]" style={{ color: "var(--color-ink-2)" }}>
            capital {money(data[hover].contributed, "USD", { compact: true })}
          </span>
        </div>
      )}
    </div>
  );
}
