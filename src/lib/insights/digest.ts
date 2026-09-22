import { z } from "zod";

/**
 * Armado del resumen de cartera que se le manda al modelo, separado de la ruta
 * para poder testearlo. Lo que viaja son tickers, pesos y numeros: ningun dato
 * personal, ningun identificador de cuenta real del broker.
 */

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
});

export const InsightRequestSchema = z.object({
  holdings: z.array(HoldingSchema).max(60),
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
    lines.push(
      `- ${h.symbol} (${h.kind}${h.account ? `, ${h.account}` : ""}): ${h.weightPct.toFixed(1)}% de la cartera, ` +
        `US$ ${n(h.valueUsd)}, costo US$ ${n(h.costUsd)}, ` +
        `retorno ${pct(h.returnPct)}, tenencia ${h.heldDays} dias`,
    );
  }
  lines.push("");

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
