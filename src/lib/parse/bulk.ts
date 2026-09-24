import type { Account, Asset } from "@/lib/types";
import type { DayKey } from "@/lib/date";
import { parseQuickEntry, type ParsedEntry } from "./quick-add";

export interface BulkRow {
  /** Indice de la linea en el texto original, para poder senalarla. */
  index: number;
  raw: string;
  entry: ParsedEntry | null;
  /** Problemas que impiden guardar la fila. */
  blockers: string[];
  include: boolean;
}

const COMMENT = /^\s*(#|\/\/|--)/;

/**
 * Interpreta un pegado de varias lineas.
 *
 * Es la puerta de entrada real para alguien que ya venia anotando sus
 * movimientos en un bloc de notas: en vez de recargar dos anios a mano, pega
 * el archivo entero y revisa lo que la app entendio.
 */
export function parseBulk(
  text: string,
  ctx: { accounts: Account[]; assets: Asset[]; defaultAccountId?: string; now?: DayKey },
): BulkRow[] {
  const lines = text.split(/\r?\n/);
  const rows: BulkRow[] = [];

  // En un bloc de notas uno escribe "pasé 500 a cocos" y en la linea siguiente
  // "compré 300 de QQQ a 430", dando por sentado que sigue hablando de la
  // misma cuenta. Arrastramos la ultima cuenta nombrada en vez de caer siempre
  // en la predeterminada.
  let lastAccount = ctx.defaultAccountId;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    // Lineas vacias, titulos de seccion y comentarios se descartan en silencio.
    if (!raw || COMMENT.test(raw)) continue;

    const entry = parseQuickEntry(raw, { ...ctx, defaultAccountId: lastAccount });
    if (entry?.accountExplicit && entry.accountId) {
      // En una transferencia, lo que sigue es la cuenta destino.
      lastAccount = entry.counterAccountId ?? entry.accountId;
    }
    const blockers: string[] = [];

    if (!entry) {
      blockers.push("No pude leer la línea.");
    } else {
      const needsAsset = entry.type === "buy" || entry.type === "sell";
      if (entry.amount === undefined || entry.amount <= 0) {
        if (!entry.all) blockers.push("Sin monto.");
      }
      if (needsAsset && !entry.symbol) blockers.push("Sin activo.");
      if (!entry.accountId) blockers.push("Sin cuenta.");
      if (entry.type === "transfer" && !entry.counterAccountId) {
        blockers.push("Falta la cuenta destino.");
      }
      // Un cambio sin los dos lados guardaria plata que sale sin nada que
      // entre, y eso si seria inventar una perdida.
      if (entry.type === "exchange" && (entry.toAmount === undefined || entry.toAmount <= 0)) {
        blockers.push("Falta el dólar al que lo pagaste.");
      }
    }

    rows.push({ index: i + 1, raw, entry, blockers, include: blockers.length === 0 });
  }

  return rows;
}

export interface BulkSummary {
  total: number;
  listos: number;
  conProblemas: number;
  sinFecha: number;
  primerDia: DayKey | null;
  ultimoDia: DayKey | null;
}

export function summarize(rows: BulkRow[]): BulkSummary {
  const incluidas = rows.filter((r) => r.include && r.entry);
  const dias = incluidas.map((r) => r.entry!.day).sort();
  return {
    total: rows.length,
    listos: incluidas.length,
    conProblemas: rows.filter((r) => r.blockers.length > 0).length,
    sinFecha: incluidas.filter((r) => !r.entry!.dateExplicit).length,
    primerDia: dias[0] ?? null,
    ultimoDia: dias[dias.length - 1] ?? null,
  };
}
