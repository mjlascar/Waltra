"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";

export const THEME_KEY = "waltra.theme";

/**
 * Aplica el tema elegido en Ajustes. Se copia tambien a localStorage para
 * que el script del <head> lo ponga antes de pintar: si no, al abrir la app
 * en blanco y negro se veria un instante en color.
 */
export function ThemeSync() {
  const { settings, ready } = useStore();
  const tema = settings.theme ?? "color";
  useEffect(() => {
    if (!ready) return;
    if (tema === "mono") document.documentElement.dataset.theme = "mono";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem(THEME_KEY, tema);
    } catch {
      // Sin almacenamiento, el tema llega igual un instante despues.
    }
  }, [tema, ready]);
  return null;
}
