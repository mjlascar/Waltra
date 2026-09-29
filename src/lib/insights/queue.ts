"use client";

import { useSyncExternalStore } from "react";
import type { ReportKind } from "@/lib/insights/schedule";

/**
 * Los pedidos de analisis que todavia no terminaron.
 *
 * Un informe tarda un minuto. Antes el formulario quedaba trabado con el
 * boton en gris hasta que volviera; ahora el pedido se anota en la lista de
 * abajo y el formulario queda libre. Vive fuera de la pantalla, en el modulo,
 * para que cambiar de pestaña y volver no lo pierda: el pedido sigue en vuelo
 * y el informe se guarda igual cuando llega.
 *
 * No se guarda en disco: si la app se cierra a mitad de camino, el pedido se
 * pierde con ella, y mostrarlo como "en curso" para siempre seria mentir.
 */
export interface Pending {
  id: string;
  kind: ReportKind;
  question?: string;
  focus?: string;
  startedAt: string;
  error?: string;
}

let pendientes: Pending[] = [];
const oyentes = new Set<() => void>();

function avisar() {
  for (const o of oyentes) o();
}

export function addPending(p: Pending) {
  pendientes = [p, ...pendientes];
  avisar();
}

export function failPending(id: string, error: string) {
  pendientes = pendientes.map((p) => (p.id === id ? { ...p, error } : p));
  avisar();
}

export function removePending(id: string) {
  pendientes = pendientes.filter((p) => p.id !== id);
  avisar();
}

const vacio: Pending[] = [];

export function usePending(): Pending[] {
  return useSyncExternalStore(
    (cb) => {
      oyentes.add(cb);
      return () => oyentes.delete(cb);
    },
    () => pendientes,
    () => vacio,
  );
}
