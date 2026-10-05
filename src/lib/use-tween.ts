"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Un numero que corre hasta su valor nuevo en vez de saltar: al cambiar de
 * moneda, de ventana o de filtro, el total pasa de uno a otro en medio
 * segundo, con la curva que frena al final. Al montar arranca quieto en su
 * valor: contar desde cero cada vez que se abre una pantalla cansa.
 *
 * Con "reducir movimiento" en el sistema, salta directo.
 */
export function useTween(value: number, ms = 450): number {
  const [shown, setShown] = useState(value);
  const desde = useRef(value);
  const actual = useRef(value);

  useEffect(() => {
    const quieto =
      typeof window === "undefined" ||
      !Number.isFinite(value) ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    desde.current = actual.current;
    const inicio = performance.now();
    let frame = 0;
    const paso = (ahora: number) => {
      const t = quieto ? 1 : Math.min(1, (ahora - inicio) / ms);
      const curva = 1 - Math.pow(1 - t, 3);
      const v = desde.current + (value - desde.current) * curva;
      actual.current = v;
      setShown(t >= 1 ? value : v);
      if (t < 1) frame = requestAnimationFrame(paso);
    };
    frame = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);

  return shown;
}
