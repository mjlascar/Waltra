import type { DayKey } from "@/lib/date";
import { addMonths } from "@/lib/date";
import type { DailyPoint } from "./returns";

/**
 * La cartera sombra: la misma plata, puesta en el indice.
 *
 * Comparar el TWR de la cartera contra el indice comprado el primer dia es
 * correcto, pero contesta otra pregunta: la de un gestor que no elige cuando
 * entra la plata. Quien aporta de a poco quiere saber que habria pasado si
 * cada peso que puso hubiera ido al S&P 500, cuando lo puso. Eso es la sombra:
 * los mismos aportes y retiros, en las mismas fechas, comprando y vendiendo el
 * indice al cierre de ese dia (la misma convencion del TWR).
 *
 * Tres maneras de hacer entrar la plata en la sombra:
 *
 * - `aportes`: como entro de verdad. Es la comparacion justa por defecto.
 * - `mensual`: el mismo capital total, en cuotas iguales una vez por mes desde
 *   el principio de la ventana. Es la vara de quien invierte todos los meses.
 * - `inicio`: todo el primer dia. Es la comparacion de siempre, TWR contra el
 *   indice, y no pasa por aca.
 *
 * Las dos curvas se miden igual: ganancia sobre el capital puesto hasta ese
 * dia, que es lo que muestra una billetera. Y al final, en plata: con el mismo
 * capital total, cuanto tendria la sombra.
 */
export type CompareMethod = "aportes" | "mensual" | "inicio";

export interface ShadowResult {
  /** Tu cartera: ganancia sobre el capital puesto, dia por dia. */
  mine: { day: DayKey; value: number }[];
  /** La sombra, medida igual. */
  theirs: { day: DayKey; value: number }[];
  /** Lo que valen las dos al final, con el mismo capital total. */
  mineValue: number;
  theirsValue: number;
  capital: number;
}

/**
 * @param daily la serie diaria de la ventana (valor al cierre y flujo externo).
 * @param price el cierre del indice ese dia, o null si no hay.
 */
export function shadowComparison(
  daily: DailyPoint[],
  price: (day: DayKey) => number | null,
  method: Exclude<CompareMethod, "inicio">,
): ShadowResult | null {
  if (daily.length < 2) return null;
  const inicio = daily[0];

  // El capital de la ventana: con lo que arranca (el flujo del primer dia ya
  // esta adentro de su cierre) mas lo que entra despues.
  const capitalAl: number[] = [];
  let capital = inicio.nav;
  capitalAl.push(capital);
  for (let i = 1; i < daily.length; i++) {
    capital += daily[i].flow;
    capitalAl.push(capital);
  }
  const total = capital;

  // Lo que la sombra pone cada dia.
  const aportes = new Array<number>(daily.length).fill(0);
  if (method === "aportes") {
    aportes[0] = inicio.nav;
    for (let i = 1; i < daily.length; i++) aportes[i] = daily[i].flow;
  } else {
    // Una cuota por mes, el mismo dia del mes que arranca la ventana; si ese
    // dia no esta en la serie (fin de semana ya esta, pero un 31 no), el
    // primero despues.
    const fechas: DayKey[] = [];
    const ultimo = daily[daily.length - 1].day;
    for (let k = 0; ; k++) {
      const f = addMonths(inicio.day, k);
      if (f > ultimo) break;
      fechas.push(f);
    }
    const cuota = total / fechas.length;
    let j = 0;
    for (let i = 0; i < daily.length && j < fechas.length; i++) {
      while (j < fechas.length && fechas[j] <= daily[i].day) {
        aportes[i] += cuota;
        j++;
      }
    }
  }

  const mine: ShadowResult["mine"] = [];
  const theirs: ShadowResult["theirs"] = [];
  let unidades = 0;
  let puesto = 0;
  let ultimoPrecio: number | null = null;
  for (let i = 0; i < daily.length; i++) {
    const d = daily[i];
    const p: number | null = price(d.day) ?? ultimoPrecio;
    if (p === null || !(p > 0)) return null;
    ultimoPrecio = p;
    // Un retiro vende indice al precio del dia; lo que se retira no puede
    // superar lo que la sombra tiene, o quedaria con unidades negativas.
    const plata = Math.max(aportes[i], -unidades * p);
    unidades += plata / p;
    puesto += plata;

    const propio = capitalAl[i] > 0 ? (d.nav - capitalAl[i]) / capitalAl[i] : 0;
    const sombra = puesto > 0 ? (unidades * p - puesto) / puesto : 0;
    mine.push({ day: d.day, value: propio });
    theirs.push({ day: d.day, value: sombra });
  }

  return {
    mine,
    theirs,
    mineValue: daily[daily.length - 1].nav,
    theirsValue: unidades * (ultimoPrecio ?? 0),
    capital: total,
  };
}
