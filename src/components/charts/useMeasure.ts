"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Ancho real del contenedor: los SVG se dibujan en pixeles, no estirados.
 *
 * La referencia es una funcion y no un objeto para que el observador se mueva
 * cuando cambia el nodo. Pasa de verdad: un grafico alterna entre su estado
 * vacio y el dibujado, y con una referencia fija el observador se quedaria
 * mirando un nodo ya desmontado.
 */
export function useMeasure<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    if (!node) return;
    setWidth(node.clientWidth);
    observer.current = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.current.observe(node);
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return { ref, width };
}
