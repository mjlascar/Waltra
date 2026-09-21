import type { Currency } from "@/lib/types";

const NBSP = " ";

/** Dinero. Compacto solo cuando el numero es grande de verdad. */
export function money(
  value: number | null | undefined,
  currency: Currency = "USD",
  options: { compact?: boolean; decimals?: number; sign?: boolean } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const symbol = currency === "USD" ? "US$" : "$";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : options.sign ? "+" : "";

  // El modo compacto tambien respeta la coma decimal: mezclar "15.4k" con
  // "1.234,56" en la misma pantalla se lee como dos monedas distintas.
  const compact = (value: number, decimals: number, suffix: string) =>
    `${sign}${symbol}${NBSP}${value.toLocaleString("es-AR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${suffix}`;

  if (options.compact && abs >= 1_000_000) {
    return compact(abs / 1_000_000, abs >= 10_000_000 ? 0 : 1, "M");
  }
  if (options.compact && abs >= 10_000) {
    return compact(abs / 1_000, abs >= 100_000 ? 0 : 1, "k");
  }
  const decimals =
    options.decimals ?? (abs >= 1000 ? 0 : abs >= 1 ? 2 : abs > 0 ? 4 : 2);
  return `${sign}${symbol}${NBSP}${abs.toLocaleString("es-AR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** Porcentaje a partir de un tanto por uno (0.1234 -> "+12,3%"). */
export function percent(
  value: number | null | undefined,
  options: { decimals?: number; sign?: boolean } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const decimals = options.decimals ?? (Math.abs(value) >= 1 ? 0 : 1);
  const sign = value > 0 && options.sign !== false ? "+" : "";
  return `${sign}${(value * 100).toLocaleString("es-AR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}%`;
}

/** Cantidad de unidades: sin ceros de relleno inutiles. */
export function quantity(value: number | null | undefined, precision = 6): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const decimals = abs >= 1000 ? 0 : abs >= 1 ? Math.min(precision, 4) : precision;
  return value.toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export function plainNumber(value: number, decimals = 2): string {
  return value.toLocaleString("es-AR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2025-06-15" -> "15 jun" o "15 jun 2024" si es de otro anio. */
export function shortDate(day: string, withYear?: boolean): string {
  const [y, m, d] = day.slice(0, 10).split("-");
  const month = MONTHS_SHORT[Number(m) - 1] ?? m;
  const thisYear = new Date().getUTCFullYear();
  const showYear = withYear ?? Number(y) !== thisYear;
  return `${Number(d)}${NBSP}${month}${showYear ? `${NBSP}${y}` : ""}`;
}

export function longDate(day: string): string {
  const [y, m, d] = day.slice(0, 10).split("-");
  return `${Number(d)} de ${MONTHS_SHORT[Number(m) - 1]} de ${y}`;
}

/** "hace 3 dias", "hoy", "hace 2 meses". */
export function relativeDate(day: string, now = new Date()): string {
  const then = Date.parse(`${day.slice(0, 10)}T00:00:00.000Z`);
  // "Hoy" es el dia del reloj del telefono, no el de UTC.
  const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  const today = Date.parse(`${local}T00:00:00.000Z`);
  const days = Math.round((today - then) / 86_400_000);
  if (days === 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 0) return shortDate(day);
  if (days < 30) return `hace ${days} días`;
  const months = Math.round(days / 30);
  if (months < 12) return `hace ${months} ${months === 1 ? "mes" : "meses"}`;
  const years = Math.floor(days / 365);
  return `hace ${years} ${years === 1 ? "año" : "años"}`;
}

/** Hora relativa corta para el "actualizado hace X". */
export function relativeTime(iso: string, now = new Date()): string {
  const diff = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(diff)) return "—";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `hace ${days} d`;
}

export const TX_LABEL: Record<string, string> = {
  deposit: "Ingreso de capital",
  withdraw: "Retiro",
  buy: "Compra",
  sell: "Venta",
  dividend: "Dividendo",
  interest: "Interés",
  fee: "Comisión",
  transfer: "Transferencia",
};

export const TX_SHORT: Record<string, string> = {
  deposit: "Ingreso",
  withdraw: "Retiro",
  buy: "Compra",
  sell: "Venta",
  dividend: "Dividendo",
  interest: "Interés",
  fee: "Comisión",
  transfer: "Transfer.",
};

export const KIND_LABEL: Record<string, string> = {
  stock: "Acción",
  cedear: "CEDEAR",
  etf: "ETF",
  crypto: "Cripto",
  fund: "Fondo",
  bond: "Bono",
  cash: "Efectivo",
};
