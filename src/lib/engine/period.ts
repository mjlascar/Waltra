import type { DayKey } from "@/lib/date";
import { daysBetween } from "@/lib/date";
import { xirr, type CashFlow, type DailyPoint, type TwrPoint } from "./returns";

/**
 * Lo que pasó dentro de una ventana de tiempo.
 *
 * Las metricas de `Portfolio` son de toda la historia, que es lo correcto para
 * "cuanto tengo" pero no para "como me fue este mes". Al elegir un rango en el
 * grafico, la pregunta pasa a ser la segunda, y los numeros de siempre se
 * quedan quietos como si nada hubiera cambiado.
 *
 * El corte respeta la convencion del TWR: el flujo del dia se asienta al
 * CIERRE, asi que el valor con el que arranca la ventana es el del cierre del
 * primer dia, y los aportes que cuentan son los de los dias siguientes. Con
 * esa alineacion, la ventana completa da exactamente los numeros de siempre.
 */
export interface PeriodView {
  from: DayKey;
  to: DayKey;
  /** La ventana cubre toda la historia. */
  full: boolean;
  /** Dias que cubre, para decidir si una tasa anualizada significa algo. */
  days: number;
  /** Valor al cierre del primer dia de la ventana. */
  startValueUsd: number;
  endValueUsd: number;
  /**
   * Capital externo neto que entro despues del primer dia. Es el que usa la
   * cuenta de la ganancia: el del primer dia ya esta adentro de `startValue`.
   */
  netFlowUsd: number;
  /**
   * Capital externo neto que entro en la ventana, el del primer dia incluido.
   * Es el numero que se muestra: entro en el periodo, aunque para la cuenta
   * de la ganancia no haga falta restarlo. Con la ventana completa da el
   * capital aportado de siempre.
   */
  contributedUsd: number;
  /** Lo que gano la cartera: el cambio de valor sin el capital que entro. */
  pnlUsd: number;
  /** Rendimiento real de la ventana, reindexado a su primer dia. */
  twr: number | null;
  /**
   * TIR anualizada de la ventana. `null` si el periodo es tan corto que
   * anualizarlo seria ruido: estirar una semana a un anio da numeros de
   * tres cifras que no dicen nada.
   */
  xirr: number | null;
}

/** Debajo de esto, una tasa anual extrapolada es ruido y no se muestra. */
const DIAS_PARA_ANUALIZAR = 90;

export function periodView(
  daily: DailyPoint[],
  twr: TwrPoint[],
  from: DayKey,
): PeriodView | null {
  const ventana = daily.filter((d) => d.day >= from);
  if (ventana.length === 0) return null;

  const primero = ventana[0];
  const ultimo = ventana[ventana.length - 1];
  const full = daily.length > 0 && primero.day === daily[0].day;

  // El flujo del primer dia ya esta adentro de su valor de cierre: sumarlo
  // otra vez contaria el aporte dos veces y la ganancia saldria de menos.
  let netFlowUsd = 0;
  for (let i = 1; i < ventana.length; i++) netFlowUsd += ventana[i].flow;

  const pnlUsd = ultimo.nav - primero.nav - netFlowUsd;

  const puntos = twr.filter((t) => t.day >= from);
  const base = puntos[0]?.index ?? 0;
  const periodoTwr =
    puntos.length > 1 && base > 0 ? puntos[puntos.length - 1].index / base - 1 : null;

  const days = daysBetween(primero.day, ultimo.day);

  // Para la TIR, el valor con el que arranca la ventana es plata puesta y el
  // valor final es plata que vuelve: la misma cuenta que la de siempre, pero
  // empezando el dia del corte en vez del primer movimiento.
  let periodoXirr: number | null = null;
  if (days >= DIAS_PARA_ANUALIZAR) {
    const flows: CashFlow[] = [];
    if (primero.nav > 0) flows.push({ day: primero.day, amount: -primero.nav });
    for (let i = 1; i < ventana.length; i++) {
      if (ventana[i].flow !== 0) flows.push({ day: ventana[i].day, amount: -ventana[i].flow });
    }
    if (ultimo.nav > 0) flows.push({ day: ultimo.day, amount: ultimo.nav });
    periodoXirr = xirr(flows);
  }

  return {
    from: primero.day,
    to: ultimo.day,
    full,
    days,
    startValueUsd: primero.nav,
    endValueUsd: ultimo.nav,
    netFlowUsd,
    contributedUsd: primero.flow + netFlowUsd,
    pnlUsd,
    twr: periodoTwr,
    xirr: periodoXirr,
  };
}
