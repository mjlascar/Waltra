import { buildDigest, degradedReport } from "@/lib/insights/digest";
import type { InsightRequest, Report } from "@/lib/insights/digest";
import { resolveModel, resolveProvider, type Provider } from "@/lib/insights/providers";
import { engineFor, ModelError, type Engine } from "@/lib/insights/engine";

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

/**
 * Que se le pide al modelo, segun la clase de informe.
 *
 * El de cartera mira para adentro: que paso con lo que tenes. El de mercado
 * ademas sale a buscar afuera, que es lo unico que puede traer algo que el
 * usuario no sabia que queria mirar. Los dos comparten el mismo esquema de
 * salida a proposito: la pantalla no tiene por que aprender dos formatos.
 */
function pedido(body: InsightRequest, portfolio: string, hoy: string): string {
  const pregunta = body.question ? `Ademas te pregunto esto en particular: ${body.question}\n\n` : "";

  if (body.kind === "mercado") {
    return `Hoy es ${hoy}. Esta es mi cartera:

${portfolio}

${pregunta}Busca que paso en los mercados en la ultima semana y que se viene en la proxima: datos macro, tasas, resultados, regulacion, y el contexto argentino (inflacion, dolar MEP, riesgo local) si tengo exposicion en pesos.

Despues escribi un informe con:
1. Como viene el mercado para lo que YO tengo. No un panorama general: el que le importa a estos tickers.
2. Que hay en la agenda de esta semana que pueda moverlos.
3. Oportunidades afuera de mi cartera: activos castigados sin que el negocio se haya roto, o con proyecciones que justifiquen mirarlos. Para cada uno, por que ahora y que tendria que pasar para que la tesis falle. Si no encontras ninguna que valga la pena, decilo: inventar una recomendacion es peor que no dar ninguna.
4. Que significa todo esto para mi cartera en concreto, dado mi perfil y mi horizonte.

Citá las fuentes con su URL. Distingui siempre entre un hecho con fecha y una lectura tuya.`;
  }

  return `Hoy es ${hoy}. Esta es mi cartera:

${portfolio}

${pregunta}Busca noticias y datos de mercado de las ultimas dos semanas que afecten especificamente a estas posiciones (resultados, guidance, tasas, regulacion, flujos, y para cripto lo que corresponda). Busca tambien el contexto macro argentino actual si tengo exposicion en pesos.

Despues escribi un informe con:
1. El contexto de mercado que le importa a ESTA cartera.
2. Una lectura por posicion: que hacer y por que, con el hecho concreto que lo respalda.
3. Que revela mi operatoria sobre como invierto en la practica, y en que se contradice con el perfil que declaro.
4. Riesgos concretos que estoy corriendo ahora mismo.

Citá las fuentes con su URL.`;
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
      user: pedido(body, portfolio, hoy),
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
