import type { Asset, AssetKind } from "@/lib/types";
import { lookupCatalog } from "@/lib/catalog";

/**
 * Importar el historial de ordenes de Binance.
 *
 * Es la exportacion "Spot Order History" (Ordenes -> Historial de ordenes spot
 * -> Exportar), que sale una fila por orden y es la comoda: la otra
 * ("Transaction History") parte cada operacion en varias filas que hay que
 * aparear por timestamp.
 *
 * Dos cosas que este archivo NO trae, y que importan:
 *
 * - Los ingresos y retiros de dinero. Solo estan las operaciones, asi que
 *   despues de importar hay que cargar a mano como entro la plata o el
 *   efectivo de la cuenta queda en negativo. `resumen.netoUsd` dice cuanto.
 * - Las comisiones. No hay columna de fee, asi que los movimientos entran sin
 *   comision y el costo queda apenas optimista.
 *
 * Las fechas vienen en la zona que el usuario eligio al exportar (el nombre
 * del archivo la dice: "(UTC--3)"), no en UTC, asi que se toman como estan.
 */

/** Columnas por las que se reconoce el archivo. */
const ESPERADAS = ["OrderNo", "Pair", "Side", "Executed", "Status"];

/**
 * Monedas de cotizacion que valen un dolar.
 *
 * Un par contra BTC o ETH no es una operacion en dolares y contarlo como tal
 * ensuciaria el costo para siempre, asi que esas filas se rechazan con su
 * motivo en vez de registrarse mal. El orden va del sufijo mas largo al mas
 * corto: "BTCFDUSD" es BTC contra FDUSD, no BTCF contra USD.
 */
const DOLARES = ["FDUSD", "BUSD", "USDC", "USDT", "TUSD", "DAI", "USD"];

/** Una orden ejecutada, ya leida. El activo se resuelve al guardar. */
export interface BinanceOrder {
  /**
   * Id estable derivado del numero de orden: volver a importar el mismo
   * archivo reemplaza en vez de duplicar, que es lo que uno espera cuando
   * exporta de nuevo para traer los ultimos meses.
   */
  id: string;
  orderNo: string;
  /** YYYY-MM-DD, de la hora de ejecucion. */
  day: string;
  /**
   * La hora de ejecucion completa, tal como vino. Sirve para ordenar las
   * ordenes del mismo dia: el archivo viene de la mas nueva a la mas vieja y
   * el desempate entre movimientos del mismo dia es el orden de carga.
   */
  at: string;
  type: "buy" | "sell";
  /** Simbolo base: BTC, ETH, SOL. */
  symbol: string;
  /** Moneda de cotizacion tal como vino: USDT, FDUSD. */
  quote: string;
  quantity: number;
  price: number;
  /** Movimiento bruto de efectivo, siempre positivo. */
  amount: number;
}

export interface BinanceRow {
  /** Numero de fila en el archivo, para que el usuario la encuentre. */
  index: number;
  raw: string;
  order?: BinanceOrder;
  /** Se omitio a proposito (una orden cancelada, por ejemplo). */
  skip?: string;
  /** No se pudo leer y hay que mirarlo. */
  error?: string;
}

export interface BinanceSummary {
  total: number;
  listos: number;
  omitidos: number;
  errores: number;
  compras: number;
  ventas: number;
  /** Dolares netos que consumen las operaciones: compras menos ventas. */
  netoUsd: number;
  primerDia?: string;
  ultimoDia?: string;
  simbolos: string[];
}

export interface BinanceImport {
  ok: boolean;
  /** Por que no es un archivo de Binance, si no lo es. */
  problema?: string;
  rows: BinanceRow[];
  resumen: BinanceSummary;
}

const VACIO: BinanceSummary = {
  total: 0,
  listos: 0,
  omitidos: 0,
  errores: 0,
  compras: 0,
  ventas: 0,
  netoUsd: 0,
  simbolos: [],
};

/** Lector de CSV minimo: comillas dobles y comas adentro de campo. */
export function parseCsv(text: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let enComillas = false;
  // Se saca la marca de orden de bytes, que Binance pone al principio.
  const s = text.replace(/^﻿/, "");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (enComillas) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          campo += '"';
          i++;
        } else enComillas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') enComillas = true;
    else if (c === ",") {
      fila.push(campo);
      campo = "";
    } else if (c === "\n") {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else if (c !== "\r") campo += c;
  }
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((v) => v.trim() !== ""));
}

/**
 * "0.033ETH" -> { valor: 0.033, activo: "ETH" }
 *
 * Binance pega el simbolo al numero, sin espacio. Tambien acepta el numero
 * solo, que es como viene "Average Price".
 */
export function splitAmount(raw: string): { valor: number; activo?: string } | null {
  const limpio = (raw ?? "").trim().replace(/,/g, "");
  const m = limpio.match(/^(-?\d*\.?\d+)\s*([A-Za-z0-9]*)$/);
  if (!m) return null;
  const valor = Number(m[1]);
  if (!Number.isFinite(valor)) return null;
  return { valor, activo: m[2] ? m[2].toUpperCase() : undefined };
}

/** Separa "BTCUSDT" en base y cotizacion, si la cotizacion es un dolar. */
export function splitPair(pair: string): { base: string; quote: string } | null {
  const p = (pair ?? "").trim().toUpperCase();
  for (const quote of DOLARES) {
    if (p.length > quote.length && p.endsWith(quote)) {
      return { base: p.slice(0, -quote.length), quote };
    }
  }
  return null;
}

/**
 * El indice de una columna, tolerando los superindices de las llamadas al pie
 * ("Type¹", "Executed²", "Trading total³") y los espacios.
 */
function findCol(head: string[], nombre: string, desde = 0): number {
  const normal = (s: string) => (s ?? "").replace(/[^A-Za-z]/g, "").toLowerCase();
  const buscado = normal(nombre);
  for (let i = desde; i < head.length; i++) {
    if (normal(head[i]) === buscado) return i;
  }
  return -1;
}

export function parseBinanceOrders(text: string): BinanceImport {
  const filas = parseCsv(text);
  if (filas.length < 2) {
    return { ok: false, problema: "El archivo está vacío.", rows: [], resumen: VACIO };
  }

  const head = filas[0];
  if (ESPERADAS.some((c) => findCol(head, c) === -1)) {
    return {
      ok: false,
      problema:
        "Esto no parece el historial de órdenes de Binance. En Binance: Órdenes → Historial de órdenes spot → Exportar.",
      rows: [],
      resumen: VACIO,
    };
  }

  const cTime = findCol(head, "Time");
  // La segunda columna "Time" es la de ejecucion, que es cuando paso de
  // verdad. En una orden de mercado son iguales; en una limit puesta hace
  // meses, no, y la que vale es la de ejecucion.
  const cFill = findCol(head, "Time", cTime + 1);
  const cOrder = findCol(head, "OrderNo");
  const cPair = findCol(head, "Pair");
  const cSide = findCol(head, "Side");
  const cExec = findCol(head, "Executed");
  const cPrice = findCol(head, "Average Price");
  const cTotal = findCol(head, "Trading total");
  const cStatus = findCol(head, "Status");

  const rows: BinanceRow[] = [];
  const simbolos = new Set<string>();
  const dias: string[] = [];
  let compras = 0;
  let ventas = 0;
  let netoUsd = 0;

  for (let i = 1; i < filas.length; i++) {
    const f = filas[i];
    const raw = f.join(",");
    const at = (col: number) => (col === -1 ? "" : (f[col] ?? "").trim());
    const push = (extra: Partial<BinanceRow>) => rows.push({ index: i, raw, ...extra });

    const status = at(cStatus).toUpperCase();
    if (status !== "FILLED") {
      // Una orden cancelada o vencida no movio un peso: se omite a proposito,
      // no es un error del archivo.
      push({ skip: status ? status.toLowerCase() : "sin estado" });
      continue;
    }

    const par = splitPair(at(cPair));
    if (!par) {
      push({ error: `El par ${at(cPair) || "(vacío)"} no cotiza contra dólares.` });
      continue;
    }

    const side = at(cSide).toUpperCase();
    if (side !== "BUY" && side !== "SELL") {
      push({ error: `No entiendo el lado «${at(cSide)}».` });
      continue;
    }

    const exec = splitAmount(at(cExec));
    if (!exec || exec.valor <= 0) {
      push({ error: "No pude leer la cantidad ejecutada." });
      continue;
    }
    const total = splitAmount(at(cTotal));
    if (!total || total.valor <= 0) {
      push({ error: "No pude leer el total operado." });
      continue;
    }

    const cuando = at(cFill) || at(cTime);
    const day = cuando.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      push({ error: "No pude leer la fecha." });
      continue;
    }

    // El precio promedio es el que vale; si vino en cero (pasa en algunas
    // ordenes de mercado) se deduce del total, que siempre esta.
    const price = splitAmount(at(cPrice));
    const unitario = price && price.valor > 0 ? price.valor : total.valor / exec.valor;

    const type = side === "BUY" ? "buy" : "sell";
    const orderNo = at(cOrder);
    simbolos.add(par.base);
    dias.push(day);
    if (type === "buy") {
      compras += 1;
      netoUsd += total.valor;
    } else {
      ventas += 1;
      netoUsd -= total.valor;
    }

    push({
      order: {
        id: orderNo ? `binance-${orderNo}` : `binance-${day}-${i}`,
        orderNo,
        day,
        at: cuando,
        type,
        symbol: par.base,
        quote: par.quote,
        quantity: exec.valor,
        price: unitario,
        amount: total.valor,
      },
    });
  }

  dias.sort();
  return {
    ok: true,
    rows,
    resumen: {
      total: rows.length,
      listos: rows.filter((r) => r.order).length,
      omitidos: rows.filter((r) => r.skip).length,
      errores: rows.filter((r) => r.error).length,
      compras,
      ventas,
      netoUsd,
      primerDia: dias[0],
      ultimoDia: dias[dias.length - 1],
      simbolos: [...simbolos].sort(),
    },
  };
}

/**
 * La definicion del activo para el simbolo base de un par.
 *
 * No alcanza con `assetFromSymbol`: su respaldo para un simbolo desconocido es
 * una accion de Yahoo, y una moneda que sale de un par spot de Binance nunca
 * lo es. Un simbolo nuevo (hay uno nuevo cada mes) entra como cripto de
 * Binance, que es lo que efectivamente es.
 */
export function binanceAsset(base: string, id: string): Asset {
  const clean = base.trim().toUpperCase();
  const entry = lookupCatalog(clean);
  if (entry) {
    return {
      id,
      symbol: entry.symbol,
      name: entry.name,
      kind: entry.kind,
      currency: entry.currency,
      source: entry.source,
      sourceSymbol: entry.sourceSymbol,
      precision: entry.precision,
    };
  }
  return {
    id,
    symbol: clean,
    name: clean,
    kind: "crypto" satisfies AssetKind,
    currency: "USD",
    source: "binance",
    sourceSymbol: `${clean}USDT`,
    precision: 8,
  };
}

/**
 * Las ordenes listas, de la mas vieja a la mas nueva.
 *
 * La exportacion viene al revés y eso importa: cuando dos movimientos caen el
 * mismo dia, el desempate es el orden de carga. Guardarlas como vienen haria
 * que una venta apareciera antes de la compra que la habilita.
 */
export function sortOrders(rows: BinanceRow[]): BinanceOrder[] {
  return rows
    .map((r) => r.order)
    .filter((o): o is BinanceOrder => Boolean(o))
    .sort((a, b) => (a.day === b.day ? a.at.localeCompare(b.at) : a.day < b.day ? -1 : 1));
}
