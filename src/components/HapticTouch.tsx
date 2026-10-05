"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { vibrar } from "@/lib/haptics";

/**
 * Un golpecito al tocar cualquier boton o enlace de la app.
 *
 * Un solo escuchador para todo en vez de uno por boton: los botones nuevos lo
 * tienen sin acordarse. Va en `click` y no en `pointerdown` a proposito: un
 * dedo que arranca un scroll arriba de un boton no tiene que vibrar, y el
 * click solo llega si el toque fue un toque. Los deshabilitados no disparan
 * click, asi que tampoco vibran.
 */
export function HapticTouch() {
  const { settings } = useStore();
  const activo = settings.haptics ?? true;

  useEffect(() => {
    if (!activo) return;
    const alTocar = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("button, a, [role='button'], summary, label");
      if (!el) return;
      // Los botones principales (guardar, pedir) se sienten un poco mas.
      vibrar(el.classList.contains("btn-primary") ? "media" : "suave");
    };
    document.addEventListener("click", alTocar, { capture: true, passive: true });
    return () => document.removeEventListener("click", alTocar, { capture: true });
  }, [activo]);

  return null;
}
