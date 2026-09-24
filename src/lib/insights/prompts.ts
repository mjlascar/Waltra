import type { InsightRequest } from "@/lib/insights/digest";
import type { ReportKind } from "@/lib/insights/schedule";

/**
 * Lo que se le pide al modelo en cada clase de informe.
 *
 * Vive aca y no en `generate.ts` porque lo usan dos caminos: el informe que
 * genera la app y el que se copia para hacer afuera. Si cada uno tuviera su
 * version, tarde o temprano dirian cosas distintas.
 *
 * La linea que separa estos informes de lo que puede dar un chat cualquiera
 * es el historial: la app sabe a que precio entro, cuando, cuantas veces
 * aporto y como reacciono a cada caida. Los informes que valen son los que
 * solo se pueden escribir con eso.
 */
export const CONSIGNA: Record<ReportKind, string> = {
  cartera: `Busca noticias y datos de mercado de las ultimas dos semanas que afecten especificamente a estas posiciones (resultados, guidance, tasas, regulacion, flujos, y para cripto lo que corresponda), y el contexto macro argentino si hay exposicion en pesos.

Despues escribi:
1. El contexto de mercado que le importa a ESTA cartera.
2. Una lectura por posicion: que hacer y por que, con el hecho concreto que lo respalda. Usa su historial de operaciones: a que precios entro, si fue promediando a la baja o persiguiendo la suba, cuanto gana o pierde desde cada compra. "Compraste 30 a US$ 21 y 13 a US$ 24.6; hoy vale 24.7: la ultima compra esta empatada" vale mas que "la posicion gana 9%".
3. Que revela la operatoria sobre como invierte en la practica, y en que se contradice con el perfil declarado.
4. Riesgos concretos que esta corriendo ahora.`,

  mercado: `Busca que paso en los mercados en la ultima semana y que se viene en la proxima: datos macro, tasas, resultados, regulacion, y el contexto argentino (inflacion, dolar MEP, riesgo local) si hay exposicion en pesos.

Despues escribi:
1. Como viene el mercado para lo que ESTA cartera tiene. No un panorama general.
2. Que hay en la agenda de esta semana que pueda moverlo.
3. Oportunidades afuera de la cartera: activos castigados sin que el negocio se haya roto, o con proyecciones que justifiquen mirarlos. Para cada uno, por que ahora y que tendria que pasar para que la tesis falle. Si no encontras ninguna que valga la pena, decilo: inventar una recomendacion es peor que no dar ninguna.
4. Que significa todo esto para esta cartera en concreto, dado el perfil y el horizonte.`,

  conducta: `Este informe NO es sobre el mercado: es sobre como invierte esta persona en la practica. Los datos de abajo salen de su historial real, no de una encuesta.

Mira la frecuencia y el tamano de los aportes, cuantas operaciones hizo, la concentracion, cuanto efectivo deja sin invertir y cuanto tiempo lleva cada posicion. Tenes el historial de compras y ventas de cada activo con fecha y precio, y las posiciones que ya cerro: fijate si compra despues de las subas o en las caidas, si promedia a la baja, si vende las ganadoras rapido y aguanta las perdedoras, y a que precio salio de lo que vendio comparado con el de hoy. Cruzalo con el perfil y el horizonte que declaro.

Escribi:
1. El retrato: como invierte de verdad, en tres o cuatro frases, sin diplomacia.
2. Donde la practica contradice lo declarado. Se concreto: "dice horizonte de 5 anos pero roto posiciones cada 6 semanas" vale; "podria ser mas disciplinado" no vale.
3. Los sesgos que se ven en los datos, con el dato que los muestra. Si no hay evidencia de un sesgo, no lo menciones.
4. Dos o tres cambios de habito que tendrian el mayor efecto, en orden de impacto.

Usa la busqueda solo si necesitas comparar contra algo (por ejemplo, cuanto rindio el indice en el mismo periodo). El material principal es el historial.`,

  riesgo: `Este informe es sobre que puede doler, no sobre que puede ganar.

Escribi:
1. Concentracion: cuanto pesa la posicion mas grande y las tres mas grandes. Que pasaria con el total si la mas grande cae 30%. En dolares, no en porcentaje.
2. Exposicion de moneda: cuanto esta en pesos y cuanto en dolares, y que significa eso viviendo en Argentina.
3. Correlacion: cuanto de la cartera se mueve junto. Dos ETFs del mismo indice o tres tecnologicas no son tres apuestas, son una.
4. Un escenario concreto: buscá una caida real de los ultimos anos (2020, 2022, la que corresponda a estos activos) y deci cuanto habria perdido ESTA cartera, en dolares, si volviera a pasar. Compara ese numero con la peor caida que ya aguanto.
5. Que riesgo conviene reducir primero y como, si alguno.

No suavices los numeros. La idea es saber de antemano cuanto se puede perder.`,

  posicion: `Este informe es sobre UN activo de la cartera, el que se indica abajo.

Busca todo lo relevante de los ultimos meses sobre ese activo: resultados, guidance, noticias del sector, cambios regulatorios, y para cripto lo que corresponda.

Escribi:
1. Que es y de que depende que suba. En terminos simples.
2. Que cambio desde que esta persona entro. Tenes cada compra y venta con fecha y precio: deci que paso con el activo entre esas fechas y hoy, y cual de sus entradas fue buena y cual no. No es lo mismo estar arriba que estar abajo, ni haber entrado una vez que haber ido comprando.
3. La tesis hoy: por que tendria sentido seguir, y por que no.
4. Que tendria que pasar para que la tesis se rompa. Concreto y observable, no "si el mercado cae".
5. Que haria vos con esta posicion, dado el peso que tiene en esta cartera y el perfil declarado.`,

  decision: `Esta persona tiene un monto para poner y quiere saber que hacer con el. El monto esta indicado abajo.

Busca el contexto de mercado actual que importe para esa decision.

Escribi:
1. Las opciones reales, dos o tres, no una lista. Para cada una: a que activo, por que, y que se estaria asumiendo.
2. Como queda la cartera despues de cada opcion. Si una empeora la concentracion, decilo con el numero. Si una es sumar a algo que ya tiene, compara el precio de hoy con su costo promedio y con sus ultimas compras.
3. Que NO haria con esa plata, y por que.
4. Si la mejor opcion es esperar o dejarlo en efectivo, decilo. Es una respuesta valida y muchas veces la correcta.
5. Una recomendacion, no cinco. Con su condicion: "esto tiene sentido si X".`,
};

/** El encabezado de cada informe, para que el texto sepa de que habla. */
export const CONSIGNA_TITULO: Record<ReportKind, string> = {
  cartera: "Analiza esta cartera",
  mercado: "Escribi un resumen de mercado para esta cartera",
  conducta: "Analiza como invierte esta persona",
  riesgo: "Analiza el riesgo de esta cartera",
  posicion: "Analiza una posicion de esta cartera",
  decision: "Recomenda que hacer con un monto nuevo",
};

/** El foco, cuando el informe lo necesita. */
export function focoTexto(body: InsightRequest): string {
  const foco = body.focus?.trim();
  if (!foco) return "";
  if (body.kind === "posicion") return `\n\nActivo a analizar: ${foco}`;
  if (body.kind === "decision") return `\n\nMonto disponible para invertir: ${foco}`;
  return "";
}

/**
 * El informe anterior, si hay.
 *
 * Es lo que la app tiene y un chat cualquiera no: puede decir que cambio
 * desde la ultima vez en vez de empezar de cero.
 */
export function anteriorTexto(body: InsightRequest): string {
  const prev = body.previous;
  if (!prev) return "";
  return `

## Informe anterior (${prev.createdAt.slice(0, 10)})

Asi estaba la cartera entonces:

${prev.digest}

Y esto se dijo:

${prev.brief}

Tenelo en cuenta: deci que cambio desde ese informe y que se mantiene igual. Si algo que se sugirio no se hizo, mencionalo. No repitas lo mismo con otras palabras.`;
}
