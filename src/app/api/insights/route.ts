import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { checkAccess } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_MODEL = "claude-opus-5";

const HoldingSchema = z.object({
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

const RequestSchema = z.object({
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
});

/** Forma exacta que la app sabe dibujar. */
const ReportSchema = z.object({
  marketBrief: z
    .string()
    .describe("2 a 4 frases sobre el contexto de mercado relevante para ESTA cartera, con datos concretos y fechados."),
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
    summary: z.string().describe("Como invierte esta persona segun sus movimientos, no segun lo que declara."),
    observations: z.array(z.string()).max(5),
    risks: z.array(z.string()).max(5),
    suggestions: z.array(z.string()).max(5),
  }),
  sources: z
    .array(z.object({ title: z.string(), url: z.string() }))
    .max(12)
    .describe("Notas concretas consultadas. Solo URLs que hayas abierto de verdad."),
});

const SYSTEM = `Sos el analista de Waltra, una app de seguimiento de inversiones de un inversor minorista argentino que opera en Cocos Capital (mercado local) y Binance (cripto).

Como trabajas:
- Escribis en castellano rioplatense, claro y directo. Nada de jerga vacia ni entusiasmo de folleto.
- Tus afirmaciones sobre el mundo vienen de la busqueda web, con fecha. Si no encontraste evidencia, lo decis: "no encontre novedades relevantes" es una respuesta valida y util.
- Distinguis con rigor entre un hecho verificado, una lectura tuya y una especulacion.
- Sos concreto con esta cartera en particular: mencionas sus tickers, sus pesos y su horizonte. Un consejo generico no sirve.
- Senalas los riesgos de concentracion, de moneda (pesos vs dolares) y de comportamiento aunque no te los pregunten.
- No prometes rendimientos ni das ordenes. Sugeris y explicas el porque.
- Cuando la cartera es chica o joven, lo decis: con dos meses de historia no hay conclusiones estadisticas que sacar.

Contexto argentino que siempre tenes presente: inflacion en pesos, brecha y dolar MEP, riesgo regulatorio local, y que los CEDEARs siguen al activo subyacente mas el tipo de cambio implicito.`;

function digest(body: z.infer<typeof RequestSchema>): string {
  const lines: string[] = [];
  const t = body.totals;
  lines.push(`Valor total: US$ ${t.valueUsd.toFixed(0)} (efectivo sin invertir: US$ ${t.cashUsd.toFixed(0)})`);
  lines.push(`Capital aportado: US$ ${t.contributedUsd.toFixed(0)} | Resultado: US$ ${t.pnlUsd.toFixed(0)}`);
  lines.push(
    `TWR: ${t.twrPct === null ? "s/d" : `${t.twrPct.toFixed(1)}%`} | TIR anual: ${
      t.xirrPct === null ? "s/d" : `${t.xirrPct.toFixed(1)}%`
    } | Volatilidad anual: ${t.volatilityPct === null ? "s/d" : `${t.volatilityPct.toFixed(1)}%`} | Peor caida: ${
      t.maxDrawdownPct === null ? "s/d" : `${t.maxDrawdownPct.toFixed(1)}%`
    }`,
  );
  lines.push(`Antiguedad de la cartera: ${t.ageDays} dias`);
  lines.push("");
  lines.push("Posiciones:");
  for (const h of body.holdings) {
    lines.push(
      `- ${h.symbol} (${h.kind}${h.account ? `, ${h.account}` : ""}): ${h.weightPct.toFixed(1)}% de la cartera, ` +
        `US$ ${h.valueUsd.toFixed(0)}, costo US$ ${h.costUsd.toFixed(0)}, ` +
        `retorno ${h.returnPct === null ? "s/d" : `${h.returnPct.toFixed(1)}%`}, tenencia ${h.heldDays} dias`,
    );
  }
  lines.push("");
  const b = body.behaviour;
  lines.push(
    `Comportamiento: ${b.transactions} movimientos en total, ${b.depositsLast90d} ingresos de capital y ` +
      `${b.tradesLast90d} operaciones en los ultimos 90 dias. Ingreso promedio: ${
        b.avgDepositUsd === null ? "s/d" : `US$ ${b.avgDepositUsd.toFixed(0)}`
      }. Cuentas: ${b.accounts.join(", ") || "s/d"}.`,
  );
  lines.push(
    `Perfil declarado: ${body.profile.riskProfile}, horizonte ${body.profile.horizonYears} anios.` +
      (body.profile.goals ? ` Objetivos: ${body.profile.goals}` : ""),
  );
  return lines.join("\n");
}

export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Falta ANTHROPIC_API_KEY. Cargala en el entorno del servidor para habilitar los insights.",
        code: "no_api_key",
      },
      { status: 503 },
    );
  }

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }
  const body = parsed.data;
  if (body.holdings.length === 0) {
    return NextResponse.json(
      { error: "Todavía no hay posiciones que analizar.", code: "empty_portfolio" },
      { status: 400 },
    );
  }

  const model = process.env.WALTRA_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey });
  const portfolio = digest(body);
  const hoy = new Date().toISOString().slice(0, 10);

  try {
    // Paso 1: investigacion con busqueda web. Va en streaming porque puede
    // encadenar varias busquedas y tardar bastante.
    const research = await client.messages
      .stream({
        model,
        max_tokens: 16000,
        system: SYSTEM,
        thinking: { type: "adaptive" },
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
        messages: [
          {
            role: "user",
            content: `Hoy es ${hoy}. Esta es mi cartera:

${portfolio}

${body.question ? `Ademas te pregunto esto en particular: ${body.question}\n\n` : ""}Busca noticias y datos de mercado de las ultimas dos semanas que afecten especificamente a estas posiciones (resultados, guidance, tasas, regulacion, flujos, y para cripto lo que corresponda). Busca tambien el contexto macro argentino actual si tengo exposicion en pesos.

Despues escribi un informe con:
1. El contexto de mercado que le importa a ESTA cartera.
2. Una lectura por posicion: que hacer y por que, con el hecho concreto que lo respalda.
3. Que revela mi operatoria sobre como invierto en la practica, y en que se contradice con el perfil que declaro.
4. Riesgos concretos que estoy corriendo ahora mismo.

Citá las fuentes con su URL.`,
          },
        ],
      })
      .finalMessage();

    const brief = research.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n\n");

    if (!brief.trim()) {
      return NextResponse.json(
        { error: "El análisis volvió vacío. Probá de nuevo en un momento.", code: "empty_research" },
        { status: 502 },
      );
    }

    // Paso 2: estructurar. Se hace en una llamada aparte porque las citas de
    // la busqueda web y el formato JSON estricto no conviven en un mismo turno.
    const structured = await client.messages.parse({
      model,
      max_tokens: 8000,
      system: "Convertis un informe de analisis en datos estructurados. No inventes nada que no este en el informe: si un campo no tiene respaldo, dejalo corto o vacio.",
      messages: [
        {
          role: "user",
          content: `Informe:\n\n${brief}\n\n---\n\nCartera analizada:\n${portfolio}\n\nEstructuralo. Las senales tienen que referirse a tickers que aparecen en la cartera, salvo que el informe recomiende explicitamente incorporar algo nuevo.`,
        },
      ],
      output_config: { format: zodOutputFormat(ReportSchema) },
    });

    const report = structured.parsed_output;
    if (!report) {
      return NextResponse.json(
        { error: "No se pudo estructurar el análisis.", code: "parse_failed" },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ...report,
      model,
      createdAt: new Date().toISOString(),
      portfolioDigest: portfolio,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof Anthropic.APIError ? err.status ?? 502 : 502;
    return NextResponse.json({ error: message, code: "api_error" }, { status });
  }
}
