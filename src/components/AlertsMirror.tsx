"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { NATIVE } from "@/lib/platform";
import { buildAlertPlan } from "@/lib/alerts/plan";
import { writeAlertPlan } from "@/lib/alerts/mirror";
import { installedApp } from "@/lib/update";

/**
 * Mantiene al vigia de precios al dia con lo que hay en la cartera.
 *
 * Cada vez que cambian las posiciones o las reglas, se recalcula el plan y se
 * guarda donde el vigia lo va a buscar. Es barato: el plan son unas pocas
 * lineas de JSON.
 *
 * La comparacion ignora la marca de tiempo, que cambia en cada armado: sin
 * eso, escribiriamos en disco en cada render.
 */
export function AlertsMirror() {
  const { portfolio, assets, settings, ready } = useStore();
  const ultimo = useRef<string | null>(null);
  // La version instalada: el vigia la necesita para saber si la publicada es
  // mas nueva, y desde su motor no la puede preguntar.
  const [build, setBuild] = useState<number | null>(null);

  useEffect(() => {
    if (!NATIVE) return;
    void installedApp().then((app) => setBuild(app?.build ?? null));
  }, []);

  useEffect(() => {
    if (!NATIVE || !ready) return;
    const plan = buildAlertPlan(portfolio, assets, settings, portfolio.fxLatest, build);
    const huella = plan ? JSON.stringify({ ...plan, at: "" }) : "";
    if (huella === ultimo.current) return;
    ultimo.current = huella;
    void writeAlertPlan(plan);
  }, [portfolio, assets, settings, ready, build]);

  return null;
}
