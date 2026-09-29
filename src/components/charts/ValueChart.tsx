"use client";

import { useMemo } from "react";
import { axisMoney, money, shortDate } from "@/lib/format";
import type { Currency } from "@/lib/types";
import { bandRuns, fitDomain, linear, linePath, niceTicks, plotArea, stepPath } from "./scale";
import { useMeasure } from "./useMeasure";
import { useStickyCursor } from "./useStickyCursor";

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
export function ValueChart({
  data,
  height = 210,
  currency = "USD",
}: {
  data: ValuePoint[];
  height?: number;
  currency?: Currency;
}) {
  const { ref, width } = useMeasure<HTMLDivElement>();

  const box = { width, height, top: 12, right: 8, bottom: 22, left: 8 };
  const area = plotArea(box);

  const model = useMemo(() => {
    // Con menos de dos puntos no hay curva que dibujar.
    if (data.length < 2 || width === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const p of data) {
      min = Math.min(min, p.value, p.contributed);
      max = Math.max(max, p.value, p.contributed);
    }
    if (min === Infinity) return null;
    // El eje se ajusta a los datos, no arranca en cero: desde cero, un mes
    // de una cartera de diez mil son dos lineas planas pegadas arriba.
    const [lo, hi] = fitDomain(min, max, 0.1);
    const ticks = niceTicks(lo, hi, 3).filter((t) => t >= lo && t <= hi);
    const x = linear([0, Math.max(1, data.length - 1)], [area.x0, area.x1]);
    const y = linear([lo, hi], [area.y1, area.y0]);
    return {
      x,
      y,
      ticks,
      step: ticks.length > 1 ? ticks[1] - ticks[0] : Math.abs(hi - lo),
      largest: Math.max(...ticks.map(Math.abs)),
      valuePts: data.map((p, i) => ({ x: x(i), y: y(p.value) })),
      capitalPts: data.map((p, i) => ({ x: x(i), y: y(p.contributed) })),
      // La banda entre las dos lineas es la ganancia, y se parte en cada
      // cruce para que un tramo en rojo no quede pintado de verde.
      banda: bandRuns(
        data.map((p, i) => ({ x: x(i), y: y(p.value) })),
        data.map((p, i) => ({ x: x(i), y: y(p.contributed) })),
      ),
    };
  }, [data, width, area.x0, area.x1, area.y0, area.y1]);

  const { selected: hover, handlers } = useStickyCursor(
    data.length,
    (clientX, rect) => {
      const ratio = (clientX - rect.left - area.x0) / Math.max(1, area.w);
      return Math.max(0, Math.min(data.length - 1, Math.round(ratio * (data.length - 1))));
    },
    (i) => area.x0 + (i / Math.max(1, data.length - 1)) * area.w,
  );

  const active = hover !== null ? data[hover] : data[data.length - 1];
  const gain = active ? active.value - active.contributed : 0;

  // El div que mide el ancho es siempre el mismo nodo: si el componente
  // devolviera otro cuando no hay curva, el observador quedaria mirando un
  // nodo desmontado y el grafico nunca sabria cuanto mide al llegar los datos.
  if (!model) {
    return (
      <div ref={ref} className="w-full">
        <div
          className="flex flex-col items-center justify-center gap-1 px-6 text-center"
          style={{ height: 120 }}
        >
          <span className="label">
            {data.length === 1
              ? "Con un solo día cargado todavía no hay curva."
              : "Sin datos en este período."}
          </span>
          {data.length === 1 && (
            <span className="label" style={{ color: "var(--color-ink-3)" }}>
              Mañana ya vas a ver la línea.
            </span>
          )}
        </div>
      </div>
    );
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
            <div className="num text-[13px] leading-tight">{money(active.value, currency, { compact: true })}</div>
            <div className={`num text-[11px] leading-tight ${gain >= 0 ? "pos" : "neg"}`}>
              {money(gain, currency, { compact: true, sign: true })}
            </div>
            {/* Este numero es la distancia entre las dos lineas, o sea la
                ganancia acumulada al dia que se mira. Las metricas de abajo
                son las del periodo elegido: sin el rotulo, dos numeros
                distintos a diez pixeles de distancia parecen un error. */}
            <div className="label leading-tight" style={{ fontSize: 9 }}>
              acumulado
            </div>
          </div>
        )}
      </div>

      {(
        <svg
          width={width}
          height={height}
          className="touch-pan-y"
          // Ver `useStickyCursor`: arrastrar recorre los dias, levantar el
          // dedo deja marcado el ultimo y tocarlo de nuevo vuelve al total.
          {...handlers}
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

          {/* La distancia entre las dos lineas ES lo que ganaste o perdiste:
              pintarla es decir en un golpe de vista lo que el numero de
              arriba dice en plata. Verde arriba del capital, rojo abajo; el
              relleno anterior iba de la linea al piso del eje, que no
              significaba nada. */}
          {model.banda.map((run, i) => (
            <path
              key={i}
              d={run.path}
              fill={run.gain ? "var(--color-pos)" : "var(--color-neg)"}
              opacity={0.16}
            />
          ))}
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
            const text = axisMoney(t, model.step, model.largest, currency);
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

          {/* Eje temporal: tres marcas alcanzan en un telefono. Se quitan las
              repetidas, que con series cortas caen todas en el mismo dia y se
              pisan unas con otras. */}
          {[...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])].map(
            (i, idx, all) => (
              <text
                key={i}
                x={model.x(i)}
                y={height - 6}
                textAnchor={
                  all.length === 1 ? "middle" : idx === 0 ? "start" : idx === all.length - 1 ? "end" : "middle"
                }
                className="num"
                fontSize={9}
                fill="var(--color-ink-3)"
              >
                {shortDate(data[i].day, data.length > 300)}
              </text>
            ),
          )}
        </svg>
      )}

      {hover !== null && data[hover] && (
        <div className="mt-1 flex items-center justify-between">
          <span className="eyebrow">{shortDate(data[hover].day, true)}</span>
          <span className="num text-[11px]" style={{ color: "var(--color-ink-2)" }}>
            capital {money(data[hover].contributed, currency, { compact: true })}
          </span>
        </div>
      )}
      {hover !== null && (
        <p className="label mt-0.5 text-[10px]">Tocá el mismo punto para volver al total.</p>
      )}
    </div>
  );
}
