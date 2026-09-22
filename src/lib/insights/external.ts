import { ReportSchema, buildDigest, degradedReport, extractUrls } from "@/lib/insights/digest";
import type { InsightRequest, Report } from "@/lib/insights/digest";
import { KIND_LABEL, type ReportKind } from "@/lib/insights/schedule";

/**
 * Informe hecho afuera.
 *
 * Un abono de claude.ai no se puede llamar desde codigo: no incluye acceso por
 * API. Pero si se puede usar a mano, y eso vale igual. La app arma el pedido
 * completo —el resumen de la cartera mas la consigna mas el formato de
 * respuesta— para copiar y pegar donde sea, y acepta de vuelta lo que venga.
 *
 * Es tambien el punto de enganche para una automatizacion: lo que sale de aca
 * es exactamente lo que un proceso programado tendria que leer, y lo que se
 * pega es exactamente lo que tendria que escribir. Sin credenciales nuevas y
 * sin que la app dependa de que ese proceso exista.
 */

const CONSIGNA: Record<ReportKind, string> = {
  cartera: `Analiza esta cartera. Busca noticias y datos de mercado de las ultimas dos semanas que afecten especificamente a estas posiciones (resultados, guidance, tasas, regulacion, flujos, y para cripto lo que corresponda), y el contexto macro argentino si hay exposicion en pesos.

Escribi:
1. El contexto de mercado que le importa a ESTA cartera.
2. Una lectura por posicion: que hacer y por que, con el hecho concreto que lo respalda.
3. Que revela la operatoria sobre como invierte en la practica, y en que se contradice con el perfil declarado.
4. Riesgos concretos que esta corriendo ahora.`,
  mercado: `Escribi un resumen de mercado para esta cartera. Busca que paso en la ultima semana y que se viene en la proxima: datos macro, tasas, resultados, regulacion, y el contexto argentino si hay exposicion en pesos.

Escribi:
1. Como viene el mercado para lo que esta cartera tiene. No un panorama general.
2. Que hay en la agenda de la semana que pueda moverlo.
3. Oportunidades afuera de la cartera: activos castigados sin que el negocio se haya roto, o con proyecciones que justifiquen mirarlos. Para cada uno, por que ahora y que tendria que pasar para que la tesis falle. Si no hay ninguna que valga la pena, decilo.
4. Que significa todo esto para esta cartera en concreto, dado el perfil y el horizonte.`,
};

const FORMATO = `Al final, y ademas del informe en prosa, devolve un bloque de codigo JSON con esta forma exacta:

\`\`\`json
{
  "marketBrief": "dos o tres frases sobre el contexto",
  "signals": [
    {
      "symbol": "QQQ",
      "action": "acumular | mantener | reducir | vender | vigilar",
      "confidence": "alta | media | baja",
      "headline": "una linea",
      "rationale": "por que, con el hecho que lo respalda",
      "horizon": "en cuanto tiempo"
    }
  ],
  "profileRead": {
    "summary": "lectura del perfil en una o dos frases",
    "observations": ["que se ve en la operatoria"],
    "risks": ["riesgos concretos"],
    "suggestions": ["que hacer"]
  },
  "sources": [{ "title": "titulo", "url": "https://..." }]
}
\`\`\`

Si no podes devolver el JSON, devolve solo la prosa: la app la acepta igual.`;

/** El texto completo para copiar y pegar donde sea. */
export function buildExternalRequest(body: InsightRequest, kind: ReportKind): string {
  const hoy = new Date().toISOString().slice(0, 10);
  return `# ${KIND_LABEL[kind]} — Waltra
Fecha: ${hoy}

${CONSIGNA[kind]}

## Cartera

${buildDigest(body)}

## Formato de respuesta

${FORMATO}
`;
}

/** Saca el primer bloque JSON de un texto, con o sin cercado de codigo. */
function extractJson(text: string): unknown | null {
  const cercado = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidatos = [cercado?.[1], text];
  for (const bruto of candidatos) {
    if (!bruto) continue;
    const desde = bruto.indexOf("{");
    const hasta = bruto.lastIndexOf("}");
    if (desde === -1 || hasta <= desde) continue;
    try {
      return JSON.parse(bruto.slice(desde, hasta + 1));
    } catch {
      // Sigue con el candidato siguiente.
    }
  }
  return null;
}

export interface ExternalReport extends Report {
  degraded: boolean;
}

/**
 * Lee lo que el usuario pego.
 *
 * Tolerante a proposito: lo ideal es el JSON, pero si lo que llega es prosa
 * —que es lo que devuelve cualquier chat si no le insistis— se guarda como
 * informe degradado, que la app ya sabe mostrar. Rechazarlo por no venir en
 * el formato exacto seria perder el informe por una formalidad.
 */
export function parseExternalReport(text: string): ExternalReport | null {
  const limpio = text.trim();
  if (limpio.length < 20) return null;

  const json = extractJson(limpio);
  if (json) {
    const parsed = ReportSchema.safeParse(json);
    if (parsed.success) {
      // Si el JSON vino sin fuentes, se rescatan las URLs de la prosa.
      const sources =
        parsed.data.sources.length > 0 ? parsed.data.sources : extractUrls(limpio);
      return { ...parsed.data, sources, degraded: false };
    }
  }

  return { ...degradedReport(limpio), degraded: true };
}
