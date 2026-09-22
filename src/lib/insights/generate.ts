import { buildDigest, degradedReport } from "@/lib/insights/digest";
import type { InsightRequest, Report } from "@/lib/insights/digest";
import { resolveModel, resolveProvider, type Provider } from "@/lib/insights/providers";
import { engineFor, ModelError, type Engine } from "@/lib/insights/engine";
import { anteriorTexto, CONSIGNA, CONSIGNA_TITULO, focoTexto } from "@/lib/insights/prompts";

/**
 * El informe con busqueda web, en dos pasos y sin saber que proveedor hay
 * detras.
 *
 * Vive fuera de la ruta /api porque corre en dos lugares: en el servidor
 * cuando la app es web, y en el propio telefono cuando es APK, con la clave
 * que cargo el usuario. Un solo camino: si se arregla un prompt, se arregla
 * para los dos.
 */

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

export class InsightError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "InsightError";
  }
}

export interface GeneratedReport extends Report {
  /** El paso de estructurado fallo y esto es el informe en prosa. */
  degraded: boolean;
  model: string;
  provider: Provider;
  createdAt: string;
  portfolioDigest: string;
}

/**
 * El informe, en dos pasos y sin saber que proveedor hay detras.
 *
 * Si el segundo paso falla NO se tira el informe: la busqueda ya se pago y el
 * texto en prosa sirve igual. Se devuelve degradado y la app lo avisa.
 */
export async function generateReport(
  engine: Engine,
  provider: Provider,
  body: InsightRequest,
): Promise<GeneratedReport> {
  if (body.holdings.length === 0) {
    throw new InsightError("Todavía no hay posiciones que analizar.", "empty_portfolio", 400);
  }

  const model = resolveModel(provider, body.model);
  const portfolio = buildDigest(body);
  const hoy = new Date().toISOString().slice(0, 10);

  let brief = "";
  let fuentes: { title: string; url: string }[] = [];
  try {
    const research = await engine.investigar({
      model,
      system: SYSTEM,
      user: `Hoy es ${hoy}. ${CONSIGNA_TITULO[body.kind]}.${focoTexto(body)}

## Cartera

${portfolio}${anteriorTexto(body)}

## Que escribir

${CONSIGNA[body.kind]}

Citá las fuentes con su URL. Distingui siempre entre un hecho con fecha y una lectura tuya.`,
    });
    brief = research.texto;
    fuentes = research.fuentes;
  } catch (err: unknown) {
    if (err instanceof ModelError) throw new InsightError(err.message, err.code, err.status);
    throw new InsightError(err instanceof Error ? err.message : String(err), "api_error", 502);
  }

  if (!brief.trim()) {
    throw new InsightError(
      "El análisis volvió vacío. Probá de nuevo en un momento.",
      "empty_research",
      502,
    );
  }

  let report: Report | null = null;
  try {
    report = await engine.estructurar({
      model,
      system:
        "Convertis un informe de analisis en datos estructurados. No inventes nada que no este en el informe: si un campo no tiene respaldo, dejalo corto o vacio.",
      user: `Informe:\n\n${brief}\n\n---\n\nCartera analizada:\n${portfolio}\n\nEstructuralo. Las senales tienen que referirse a tickers que aparecen en la cartera, salvo que el informe recomiende explicitamente incorporar algo nuevo.`,
    });
  } catch {
    report = null;
  }

  let degraded = false;
  if (!report) {
    report = degradedReport(brief);
    degraded = true;
  }

  // Las fuentes que el proveedor entrego aparte tienen prioridad: son las que
  // realmente se consultaron, no las que el modelo dijo que consulto.
  const sources = fuentes.length > 0 ? fuentes : report.sources;

  return {
    ...report,
    sources,
    degraded,
    model,
    provider,
    createdAt: new Date().toISOString(),
    portfolioDigest: portfolio,
  };
}

/** Arma el motor del proveedor que corresponda y genera. */
export async function generate(
  provider: string | undefined,
  apiKey: string,
  onDevice: boolean,
  body: InsightRequest,
): Promise<GeneratedReport> {
  const elegido = resolveProvider(provider);
  const engine = await engineFor(elegido, apiKey, onDevice);
  return generateReport(engine, elegido, body);
}
