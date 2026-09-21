"use client";

import { useEffect } from "react";

/**
 * Registra el service worker para que la app se instale en el telefono y
 * abra sin conexion. Los datos ya viven en IndexedDB, asi que offline la app
 * es plenamente usable: lo unico que no anda es refrescar precios.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    const register = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}
