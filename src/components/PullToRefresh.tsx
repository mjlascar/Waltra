"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { overlayOpen } from "@/components/ui/overlay";

const THRESHOLD = 70;
const MAX_PULL = 110;

/**
 * Tirar hacia abajo para actualizar precios.
 *
 * Es el gesto que cualquiera prueba primero en un telefono. Se implementa a
 * mano y no con una libreria porque el indicador tiene que seguir la misma
 * gramatica que el resto: una barra recta que se llena, sin ruedita girando.
 *
 * Solo se activa cuando la pagina ya esta arriba de todo y el dedo va hacia
 * abajo, asi no interfiere con el scroll normal.
 */
export function PullToRefresh() {
  const { refresh, sync } = useStore();
  const [pull, setPull] = useState(0);
  const startY = useRef<number | null>(null);
  const active = useRef(false);

  const syncing = sync.status === "syncing";

  const onTouchStart = useCallback((e: TouchEvent) => {
    // Con una hoja abierta el body no scrollea, asi que la pagina siempre
    // esta arriba de todo: sin esta guarda, cada intento de subir el
    // contenido de la hoja se lo comia el refresco.
    if (overlayOpen()) return;
    if (window.scrollY > 0) return;
    startY.current = e.touches[0].clientY;
    active.current = false;
  }, []);

  const onTouchMove = useCallback(
    (e: TouchEvent) => {
      if (startY.current === null || syncing || overlayOpen()) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0 || window.scrollY > 0) {
        if (active.current) {
          active.current = false;
          setPull(0);
        }
        return;
      }
      active.current = true;
      // Resistencia: el recorrido se acorta a medida que estiras, para que se
      // sienta un elastico y no un cajon.
      const resisted = Math.min(MAX_PULL, delta * 0.45);
      setPull(resisted);
      if (e.cancelable) e.preventDefault();
    },
    [syncing],
  );

  const onTouchEnd = useCallback(() => {
    if (active.current && pull >= THRESHOLD && !syncing) void refresh();
    startY.current = null;
    active.current = false;
    setPull(0);
  }, [pull, refresh, syncing]);

  useEffect(() => {
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [onTouchStart, onTouchMove, onTouchEnd]);

  const visible = pull > 0 || syncing;
  const progress = syncing ? 1 : Math.min(1, pull / THRESHOLD);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-30 flex flex-col items-center"
      style={{
        height: visible ? Math.max(28, pull) : 0,
        opacity: visible ? 1 : 0,
        transition: pull === 0 ? "height 160ms ease, opacity 160ms ease" : "none",
        overflow: "hidden",
      }}
    >
      <div style={{ height: 2, width: "100%", background: "var(--color-line)" }}>
        <div
          style={{
            height: 2,
            width: `${progress * 100}%`,
            background: progress >= 1 ? "var(--color-ink)" : "var(--color-ink-3)",
          }}
        />
      </div>
      <span className="eyebrow mt-2">
        {syncing ? "actualizando…" : progress >= 1 ? "soltar para actualizar" : "deslizá para actualizar"}
      </span>
    </div>
  );
}
