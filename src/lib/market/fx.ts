import type { FxRate } from "@/lib/types";
import { toDay } from "@/lib/date";
import { getJson } from "./types";

interface DolarApiRow {
  casa?: string;
  nombre?: string;
  compra?: number;
  venta?: number;
  fechaActualizacion?: string;
}

interface ArgentinaDatosRow {
  casa?: string;
  fecha?: string;
  compra?: number;
  venta?: number;
}

/** Punto medio entre compra y venta; si falta uno, el que haya. */
function mid(row: { compra?: number; venta?: number }): number | null {
  const buy = typeof row.compra === "number" && row.compra > 0 ? row.compra : null;
  const sell = typeof row.venta === "number" && row.venta > 0 ? row.venta : null;
  if (buy !== null && sell !== null) return (buy + sell) / 2;
  return sell ?? buy;
}

/**
 * Dolar MEP de hoy. Es el tipo de cambio relevante para alguien que invierte
 * desde Argentina: es el que efectivamente consigue al pasar pesos a dolares.
 */
export async function fxLatest(): Promise<FxRate | null> {
  try {
    const row = await getJson<DolarApiRow>("https://dolarapi.com/v1/dolares/bolsa");
    const value = mid(row);
    if (value === null) return null;
    return { date: row.fechaActualizacion ? toDay(row.fechaActualizacion) : toDay(new Date()), arsPerUsd: value };
  } catch {
    return null;
  }
}

/** Serie historica del MEP, para valuar movimientos viejos en pesos. */
export async function fxHistory(): Promise<FxRate[]> {
  try {
    const rows = await getJson<ArgentinaDatosRow[]>(
      "https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa",
      { timeoutMs: 20_000 },
    );
    const out: FxRate[] = [];
    for (const row of rows) {
      if (!row.fecha) continue;
      const value = mid(row);
      if (value === null) continue;
      out.push({ date: toDay(row.fecha), arsPerUsd: value });
    }
    out.sort((a, b) => (a.date < b.date ? -1 : 1));
    return out;
  } catch {
    return [];
  }
}
