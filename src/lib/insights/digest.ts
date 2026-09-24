import { z } from "zod";

/**
 * Armado del resumen de cartera que se le manda al modelo, separado de la ruta
 * para poder testearlo. Lo que viaja son tickers, pesos y numeros: ningun dato
 * personal, ningun identificador de cuenta real del broker.
 */

/**
 * Una compra o venta, como viaja al modelo: fecha, lado, cantidad y precio en
 * dolares de ese dia. Sin notas ni la frase original: esas son del usuario y
 * pueden decir cualquier cosa, los numeros no.
 */
export const TradeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  side: z.enum(["compra", "venta"]),
  quantity: z.number(),
  priceUsd: z.number().nullable(),
});

/**
 * Cuantas operaciones por activo se mandan. Las mas recientes: con decenas de
 * compras chicas mensuales, mandar todas agranda el pedido sin cambiar la
 * lectura. Las que quedan afuera se cuentan, para que el modelo sepa que hay.
 */
export const MAX_TRADES = 30;

const tradeHistory = {
  trades: z.array(TradeSchema).max(MAX_TRADES).optional(),
  /** Operaciones mas viejas que no entraron en `trades`. */
  olderTrades: z.number().int().min(0).optional(),
};

export const HoldingSchema = z.object({
  symbol: z.string(),
  name: z.string().optional(),
  kind: z.string(),
  weightPct: z.number(),
  valueUsd: z.number(),
  costUsd: z.number(),
  returnPct: z.number().nullable(),
  heldDays: z.number(),
  account: z.string().optional(),
  quantity: z.number().optional(),
  /** Costo promedio por unidad y precio actual, los dos en dolares. */
  avgCostUsd: z.number().nullable().optional(),
  priceUsd: z.number().nullable().optional(),
  /** Lo ya realizado en ventas parciales de este activo. */
  realizedUsd: z.number().optional(),
  /**
   * Cambios de ratio o splits. Las operaciones ya viajan en unidades de hoy;
   * esto le dice al modelo por que una compra de 9 figura como 22,5, para que
   * no lo lea como un error ni como una caida del precio.
   */
  splits: z
    .array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), ratio: z.number() }))
    .max(10)
    .optional(),
  ...tradeHistory,
});

/** Lo que se vendio entero: lo que dejo y como se opero. */
export const ClosedSchema = z.object({
  symbol: z.string(),
  kind: z.string(),
  realizedUsd: z.number(),
  ...tradeHistory,
});

export const InsightRequestSchema = z.object({
  holdings: z.array(HoldingSchema).max(60),
  closed: z.array(ClosedSchema).max(30).optional(),
  totals: z.object({
    valueUsd: z.number(),
    contributedUsd: z.number(),
    cashUsd: z.number(),
    pnlUsd: z.number(),
    twrPct: z.number().nullable(),
    xirrPct: z.number().nullable(),
    volatilityPct: z.number().nullable(),
    maxDrawdownPct: z.number().nullable(),
    ageDays: z.number(),
  }),
  behaviour: z.object({
    transactions: z.number(),
    depositsLast90d: z.number(),
    tradesLast90d: z.number(),
    avgDepositUsd: z.number().nullable(),
    accounts: z.array(z.string()),
  }),
  profile: z.object({
    riskProfile: z.string(),
    horizonYears: z.number(),
    goals: z.string().max(600),
  }),
  question: z.string().max(400).optional(),
  /** Que clase de informe se pide. Ver `src/lib/insights/schedule.ts`. */
  kind: z
    .enum(["cartera", "mercado", "conducta", "riesgo", "posicion", "decision"])
    .default("cartera"),
  /**
   * Sobre que, para los informes que lo necesitan: el ticker en "posicion",
   * el monto en "decision".
   */
  focus: z.string().max(80).optional(),
  /**
   * Un informe anterior, para que este pueda decir que cambio. Es lo que la
   * app tiene y un chat cualquiera no.
   */
  previous: z
    .object({
      createdAt: z.string().max(40),
      digest: z.string().max(6000),
      brief: z.string().max(6000),
    })
    .optional(),
  /** Modelo elegido por el usuario. Se valida contra una lista blanca. */
  model: z.string().max(60).optional(),
  /** Proveedor elegido. Tambien se valida: decide que clave se gasta. */
  provider: z.string().max(20).optional(),
});

export type InsightRequest = z.output<typeof InsightRequestSchema>;
/** Lo que arma la pantalla, antes de que el esquema complete los faltantes. */
export type InsightRequestInput = z.input<typeof InsightRequestSchema>;

export const ReportSchema = z.object({
  marketBrief: z
    .string()
    .describe(
      "2 a 4 frases sobre el contexto de mercado relevante para ESTA cartera, con datos concretos y fechados.",
    ),
  signals: z
    .array(
      z.object({
        symbol: z.string().describe("Ticker tal como aparece en la cartera, o uno nuevo sugerido."),
        action: z.enum(["acumular", "mantener", "reducir", "vender", "vigilar"]),
        confidence: z.enum(["alta", "media", "baja"]),
        headline: z.string().describe("Una linea de 6 a 12 palabras."),
        rationale: z
          .string()
          .describe("2 a 4 frases. Incluye el hecho concreto y la fecha o fuente que lo respalda."),
        horizon: z.string().describe("Horizonte sugerido, por ejemplo: 3-6 meses."),
      }),
    )
    .max(8),
  profileRead: z.object({
    summary: z
      .string()
      .describe("Como invierte esta persona segun sus movimientos, no segun lo que declara."),
    observations: z.array(z.string()).max(5),
    risks: z.array(z.string()).max(5),
    suggestions: z.array(z.string()).max(5),
  }),
  sources: z
    .array(z.object({ title: z.string(), url: z.string() }))
    .max(12)
    .describe("Notas concretas consultadas. Solo URLs que hayas abierto de verdad."),
});

export type Report = z.infer<typeof ReportSchema>;

const n = (value: number, decimals = 0) =>
  Number.isFinite(value) ? value.toFixed(decimals) : "s/d";

const pct = (value: number | null) =>
  value === null || !Number.isFinite(value) ? "s/d" : `${value.toFixed(1)}%`;

/**
 * Un precio por unidad: con centavos salvo que sea grande. Un CEDEAR de
 * US$ 100,50 redondeado a 101 es otra compra; un bitcoin de 62.000, no.
 */
const usd = (value: number) => n(value, Math.abs(value) < 1000 ? 2 : 0);

/** Una cantidad sin ceros de relleno: 9, 0.011, 59. */
const qty = (value: number) =>
  Number.isFinite(value) ? String(Number(value.toFixed(8))) : "s/d";

/** La historia de un activo en una linea: fecha, lado, cantidad y precio. */
function operaciones(trades: z.output<typeof TradeSchema>[] | undefined, older = 0): string {
  if (!trades?.length) return "";
  const partes = trades.map(
    (t) =>
      `${t.date} ${t.side} ${qty(t.quantity)}` +
      (t.priceUsd === null ? " (precio en pesos, sin dolar)" : ` a US$ ${usd(t.priceUsd)}`),
  );
  return (
    `Operaciones: ${partes.join("; ")}` +
    (older > 0 ? ` (y ${older} ${older === 1 ? "anterior" : "anteriores"})` : "")
  );
}

/** Convierte la cartera en el texto que lee el modelo. */
export function buildDigest(body: InsightRequest): string {
  const lines: string[] = [];
  const t = body.totals;

  lines.push(`Valor total: US$ ${n(t.valueUsd)} (efectivo sin invertir: US$ ${n(t.cashUsd)})`);
  lines.push(`Capital aportado: US$ ${n(t.contributedUsd)} | Resultado: US$ ${n(t.pnlUsd)}`);
  lines.push(
    `TWR: ${pct(t.twrPct)} | TIR anual: ${pct(t.xirrPct)} | Volatilidad anual: ${pct(
      t.volatilityPct,
    )} | Peor caida: ${pct(t.maxDrawdownPct)}`,
  );
  lines.push(`Antiguedad de la cartera: ${t.ageDays} dias`);
  lines.push("");

  lines.push("Posiciones:");
  if (body.holdings.length === 0) lines.push("- (ninguna)");
  for (const h of body.holdings) {
    const unidades =
      h.quantity !== undefined
        ? `, ${qty(h.quantity)} unidades` +
          (h.avgCostUsd != null ? `, costo promedio US$ ${usd(h.avgCostUsd)} por unidad` : "") +
          (h.priceUsd != null ? `, precio actual US$ ${usd(h.priceUsd)}` : "")
        : "";
    lines.push(
      `- ${h.symbol} (${h.kind}${h.account ? `, ${h.account}` : ""}): ${h.weightPct.toFixed(1)}% de la cartera, ` +
        `US$ ${n(h.valueUsd)}, costo US$ ${n(h.costUsd)}, ` +
        `retorno ${pct(h.returnPct)}, tenencia ${h.heldDays} dias${unidades}` +
        (h.realizedUsd ? `, ya realizado US$ ${n(h.realizedUsd)}` : ""),
    );
    if (h.splits?.length) {
      lines.push(
        `  Cambios de ratio: ${h.splits
          .map((sp) => `${sp.date} cada unidad paso a ser ${qty(sp.ratio)}`)
          .join("; ")} (las operaciones ya estan expresadas en unidades de hoy)`,
      );
    }
    const historia = operaciones(h.trades, h.olderTrades);
    if (historia) lines.push(`  ${historia}`);
  }
  lines.push("");

  // Lo que ya no esta tambien dice como invierte: si vende ganadoras rapido,
  // si aguanta perdedoras. Sin esto el analisis solo ve a los sobrevivientes.
  if (body.closed?.length) {
    lines.push("Posiciones cerradas (vendidas enteras):");
    for (const c of body.closed) {
      lines.push(`- ${c.symbol} (${c.kind}): resultado realizado US$ ${n(c.realizedUsd)}`);
      const historia = operaciones(c.trades, c.olderTrades);
      if (historia) lines.push(`  ${historia}`);
    }
    lines.push("");
  }

  const b = body.behaviour;
  lines.push(
    `Comportamiento: ${b.transactions} movimientos en total, ${b.depositsLast90d} ingresos de capital y ` +
      `${b.tradesLast90d} operaciones en los ultimos 90 dias. Ingreso promedio: ${
        b.avgDepositUsd === null ? "s/d" : `US$ ${n(b.avgDepositUsd)}`
      }. Cuentas: ${b.accounts.join(", ") || "s/d"}.`,
  );
  lines.push(
    `Perfil declarado: ${body.profile.riskProfile}, horizonte ${body.profile.horizonYears} anios.` +
      (body.profile.goals ? ` Objetivos: ${body.profile.goals}` : ""),
  );

  return lines.join("\n");
}

/** Rescata las URLs citadas en el texto para no perder las fuentes. */
export function extractUrls(text: string): { title: string; url: string }[] {
  const seen = new Set<string>();
  const out: { title: string; url: string }[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s)\]>"']+/g)) {
    const url = match[0].replace(/[.,;:]+$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      out.push({ title: new URL(url).hostname.replace(/^www\./, ""), url });
    } catch {
      // Una URL rota en el texto no puede tumbar el informe entero.
    }
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * Si el paso de estructurado falla, el informe en prosa igual sirve: mostrarlo
 * tal cual es mejor que tirar a la basura una busqueda que ya se pago.
 */
export function degradedReport(brief: string): Report {
  return {
    marketBrief: brief.trim().slice(0, 4000),
    signals: [],
    profileRead: { summary: "", observations: [], risks: [], suggestions: [] },
    sources: extractUrls(brief),
  };
}
