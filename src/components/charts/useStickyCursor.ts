"use client";

import { useRef, useState } from "react";
import type { PointerEvent } from "react";

/** Cuan cerca del dia marcado cuenta como tocarlo de nuevo, en pixeles. */
const CERCA_PX = 22;
/** Menos que esto entre apoyar y levantar el dedo es un toque, no un arrastre. */
const TOQUE_PX = 8;

/**
 * La cruceta de los graficos, que se queda donde se la deja.
 *
 * Arrastrar recorre los dias y levantar el dedo deja marcado el ultimo: se
 * puede leer el dato con la mano fuera de la pantalla. Tocar de nuevo ese dia
 * (o cerca) lo desmarca y vuelve al total. Si el gesto termina siendo un
 * scroll de la pagina, el sistema lo cancela y queda lo que habia antes: un
 * scroll no puede mover la seleccion.
 *
 * La captura del puntero sigue siendo la que evita que la cruceta se cuelgue
 * al arrastrar hasta el borde: los eventos llegan aunque el dedo salga del
 * grafico.
 */
export function useStickyCursor(
  count: number,
  indexAt: (clientX: number, rect: DOMRect) => number,
  xAt: (index: number) => number,
) {
  const [sel, setSel] = useState<number | null>(null);
  const gesto = useRef<{ startX: number; prev: number | null; moved: boolean } | null>(null);

  const selected = sel !== null && sel < count ? sel : null;

  const handlers = {
    onPointerDown: (e: PointerEvent<SVGSVGElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      gesto.current = { startX: e.clientX, prev: selected, moved: false };
      setSel(indexAt(e.clientX, e.currentTarget.getBoundingClientRect()));
    },
    onPointerMove: (e: PointerEvent<SVGSVGElement>) => {
      const g = gesto.current;
      if (!g) return;
      if (Math.abs(e.clientX - g.startX) > TOQUE_PX) g.moved = true;
      setSel(indexAt(e.clientX, e.currentTarget.getBoundingClientRect()));
    },
    onPointerUp: (e: PointerEvent<SVGSVGElement>) => {
      const g = gesto.current;
      gesto.current = null;
      if (!g || g.moved || g.prev === null) return;
      const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
      // Un toque sobre el dia que ya estaba marcado lo suelta.
      if (Math.abs(xAt(g.prev) - x) < CERCA_PX) setSel(null);
    },
    onPointerCancel: () => {
      const g = gesto.current;
      gesto.current = null;
      if (g) setSel(g.prev);
    },
  };

  return { selected, handlers, clear: () => setSel(null) };
}
