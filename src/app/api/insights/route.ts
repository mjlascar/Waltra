import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { checkAccess } from "@/lib/api-auth";
import {
  InsightRequestSchema,
  ReportSchema,
  buildDigest,
  degradedReport,
} from "@/lib/insights/digest";
import { modelShape, resolveModel } from "@/lib/insights/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  const parsed = InsightRequestSchema.safeParse(await request.json().catch(() => null));
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

  const model = resolveModel(body.model);
  const shape = modelShape(model);
  const client = new Anthropic({ apiKey });
  const portfolio = buildDigest(body);
  const hoy = new Date().toISOString().slice(0, 10);

  let brief = "";
  try {
    // Paso 1: investigacion con busqueda web. Va en streaming porque puede
    // encadenar varias busquedas y tardar bastante.
    const research = await client.messages
      .stream({
        model,
        max_tokens: 16000,
        system: SYSTEM,
        ...(shape.adaptiveThinking ? { thinking: { type: "adaptive" as const } } : {}),
        tools: [{ type: shape.webSearchType, name: "web_search", max_uses: 8 }],
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

    brief = research.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof Anthropic.APIError ? (err.status ?? 502) : 502;
    return NextResponse.json({ error: message, code: "api_error" }, { status });
  }

  if (!brief.trim()) {
    return NextResponse.json(
      { error: "El análisis volvió vacío. Probá de nuevo en un momento.", code: "empty_research" },
      { status: 502 },
    );
  }

  // Paso 2: estructurar. Se hace en una llamada aparte porque las citas de la
  // busqueda web y el formato JSON estricto no conviven bien en un mismo turno.
  //
  // Si este paso falla, NO tiramos el informe: la busqueda ya se pago y el
  // texto en prosa sirve igual. Se devuelve degradado y la app lo avisa.
  let report = null;
  let degraded = false;
  try {
    const structured = await client.messages.parse({
      model,
      max_tokens: 8000,
      system:
        "Convertis un informe de analisis en datos estructurados. No inventes nada que no este en el informe: si un campo no tiene respaldo, dejalo corto o vacio.",
      messages: [
        {
          role: "user",
          content: `Informe:\n\n${brief}\n\n---\n\nCartera analizada:\n${portfolio}\n\nEstructuralo. Las senales tienen que referirse a tickers que aparecen en la cartera, salvo que el informe recomiende explicitamente incorporar algo nuevo.`,
        },
      ],
      output_config: { format: zodOutputFormat(ReportSchema) },
    });
    report = structured.parsed_output;
  } catch {
    report = null;
  }

  if (!report) {
    report = degradedReport(brief);
    degraded = true;
  }

  return NextResponse.json({
    ...report,
    degraded,
    model,
    createdAt: new Date().toISOString(),
    portfolioDigest: portfolio,
  });
}
