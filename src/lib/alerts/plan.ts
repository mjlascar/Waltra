import type { Asset, Currency, QuoteSource, Settings } from "@/lib/types";
import type { Portfolio } from "@/lib/engine/portfolio";

/**
 * El plan de alertas: lo unico que el vigia de precios sabe de tu cartera.
 *
 * El vigia corre en un motor JavaScript aparte, fuera del WebView, que no
 * puede abrir IndexedDB. Asi que la app le deja un resumen en un almacen de
 * clave-valor y el lo lee cuando Android lo despierta.
 *
 * Lo que viaja es deliberadamente poco: tickers, cantidades y umbrales. No van
 * los movimientos, ni el costo, ni la ganancia. Alcanza para decir "BTC bajo
 * 6%" y para estimar cuanto se movio el total, que es todo lo que una
 * notificacion tiene que hacer. El numero que vale sigue siendo el de la app.
 */

export const ALERT_PLAN_KEY = "waltra.alertas.plan";
/** El estado del vigia entre corridas: que ya aviso y cuando. */
export const ALERT_STATE_KEY = "waltra.alertas.estado";

export interface AlertRules {
  enabled: boolean;
  /** Umbral por defecto, en puntos de porcentaje de variacion diaria. */
  defaultPct: number;
  /** Excepciones por activo. Un 0 apaga las alertas de ese activo. */
  perAsset: Record<string, number>;
  /** Umbral para la cartera entera. 0 lo apaga. */
  portfolioPct: number;
  /** Hora del resumen diario (0-23), o null para no tenerlo. */
  digestHour: number | null;
  /** Franja sin molestar, en horas locales. */
  quietFrom: number;
  quietTo: number;
}

export const DEFAULT_ALERTS: AlertRules = {
  enabled: false,
  defaultPct: 5,
  perAsset: {},
  portfolioPct: 3,
  digestHour: null,
  quietFrom: 23,
  quietTo: 8,
};

/** Un activo tal como lo ve el vigia. Nombres cortos: esto se serializa. */
export interface AlertPlanAsset {
  sym: string;
  src: Exclude<QuoteSource, "manual">;
  ss: string;
  cur: Currency;
  qty: number;
  pct: number;
}

export interface AlertPlan {
  v: 1;
  at: string;
  quiet: [number, number] | null;
  digestHour: number | null;
  portfolioPct: number;
  /** Efectivo y tipo de cambio: sin esto el total del vigia no cierra. */
  cashUsd: number;
  arsPerUsd: number;
  assets: AlertPlanAsset[];
}

export function alertRules(settings: Settings): AlertRules {
  return { ...DEFAULT_ALERTS, ...(settings.alerts ?? {}) };
}

/** El umbral que rige para un activo: su excepcion, o el general. */
export function thresholdFor(rules: AlertRules, assetId: string): number {
  const own = rules.perAsset[assetId];
  return own === undefined ? rules.defaultPct : own;
}

/**
 * Arma el plan a partir de la cartera de verdad.
 *
 * Devuelve null cuando no hay nada que vigilar: sin reglas activas, sin
 * posiciones cotizables o sin un solo umbral encendido, dejar un plan vacio
 * solo lograria que el telefono se despierte cada media hora al pedo.
 */
export function buildAlertPlan(
  portfolio: Portfolio,
  assets: Asset[],
  settings: Settings,
  arsPerUsd: number,
): AlertPlan | null {
  const rules = alertRules(settings);
  if (!rules.enabled) return null;

  const byId = new Map(assets.map((a) => [a.id, a]));
  const planAssets: AlertPlanAsset[] = [];

  for (const pos of portfolio.positions) {
    const asset = byId.get(pos.assetId);
    if (!asset || asset.source === "manual" || asset.archived) continue;
    if (pos.quantity <= 0) continue;
    planAssets.push({
      sym: pos.symbol,
      src: asset.source,
      ss: asset.sourceSymbol,
      cur: asset.currency,
      qty: pos.quantity,
      pct: thresholdFor(rules, pos.assetId),
    });
  }

  const vigilaAlgo =
    planAssets.some((a) => a.pct > 0) || rules.portfolioPct > 0 || rules.digestHour !== null;
  if (!vigilaAlgo || planAssets.length === 0) return null;

  return {
    v: 1,
    at: new Date().toISOString(),
    quiet: rules.quietFrom === rules.quietTo ? null : [rules.quietFrom, rules.quietTo],
    digestHour: rules.digestHour,
    portfolioPct: rules.portfolioPct,
    cashUsd: portfolio.cashUsd,
    arsPerUsd: arsPerUsd > 0 ? arsPerUsd : 0,
    assets: planAssets,
  };
}
