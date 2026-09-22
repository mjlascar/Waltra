"use client";

import { Sheet } from "@/components/ui/Sheet";
import { money, percent } from "@/lib/format";
import type { Portfolio } from "@/lib/engine/portfolio";
import type { PeriodView } from "@/lib/engine/period";

/**
 * Qué significa cada número, con los números del usuario adentro.
 *
 * La queja que origino la app fue "las metricas se mezclan y confunden". Una
 * definicion generica de TWR no resuelve eso; verla aplicada a la propia
 * cartera, si.
 */
export function MetricsExplainer({
  portfolio: p,
  periodo,
  desde,
  open,
  onClose,
}: {
  portfolio: Portfolio;
  /** La ventana elegida en el gráfico. Null mientras no hay historia. */
  periodo: PeriodView | null;
  /** Cómo se lee esa ventana: "en el último mes". */
  desde: string;
  open: boolean;
  onClose: () => void;
}) {
  // Los numeros que se explican tienen que ser los mismos que el usuario
  // acaba de tocar: si arriba dice la ganancia del mes y aca la de siempre,
  // la explicacion confunde mas de lo que aclara.
  const completo = !periodo || periodo.full;
  const capital = completo ? p.netContributedUsd : periodo.contributedUsd;
  const ganancia = completo ? p.totalPnlUsd : periodo.pnlUsd;
  const rendimiento = completo ? p.metrics.twrCumulative : periodo.twr;
  const tir = completo ? p.metrics.xirr : periodo.xirr;

  const entradas = [
    {
      titulo: completo ? "Capital aportado" : "Capital que entró",
      valor: money(capital, "USD"),
      cuerpo: completo
        ? `Todo lo que ingresaste menos todo lo que retiraste: ${money(p.depositedUsd, "USD")} de ingresos y ${money(p.withdrawnUsd, "USD")} de retiros. Transferir de Cocos a Binance no suma acá: no es capital nuevo, solo cambia de lugar. Comprar tampoco: convertís efectivo en un activo, pero el patrimonio es el mismo.`
        : `Lo que ingresaste menos lo que retiraste ${desde}. Transferir de Cocos a Binance no suma acá: no es capital nuevo, solo cambia de lugar. Comprar tampoco: convertís efectivo en un activo, pero el patrimonio es el mismo. En total, desde el primer movimiento, llevás ${money(p.netContributedUsd, "USD")}.`,
    },
    {
      titulo: "Ganancia",
      valor: money(ganancia, "USD", { sign: true }),
      cuerpo: completo
        ? `Lo que vale hoy la cartera (${money(p.totalValueUsd, "USD")}) menos el capital aportado (${money(p.netContributedUsd, "USD")}). Incluye lo que subieron tus posiciones${p.realizedUsd !== 0 ? `, lo que ya realizaste al vender (${money(p.realizedUsd, "USD", { sign: true })})` : ""}${p.incomeUsd > 0 ? ` y lo que cobraste en dividendos e intereses (${money(p.incomeUsd, "USD")})` : ""}${p.feesUsd > 0 ? `, descontando ${money(p.feesUsd, "USD")} de comisiones` : ""}.`
        : `Lo que vale hoy la cartera (${money(periodo.endValueUsd, "USD")}) menos lo que valía al empezar el período (${money(periodo.startValueUsd, "USD")}), descontando los ${money(periodo.netFlowUsd, "USD")} de capital que entraron en el medio. Esa resta es la razón de ser de la app: sin ella, un ingreso de plata se vería como si lo hubieras ganado.`,
    },
    {
      titulo: "Rendimiento real (TWR)",
      valor: percent(rendimiento, { decimals: 1 }),
      cuerpo:
        "Qué tan bien elegiste, sin que el momento de los aportes distorsione el número. Se encadenan los retornos de cada día neutralizando las entradas y salidas: si aportás 1.000 dólares nuevos, el valor sube pero el rendimiento no se mueve. Es la métrica que los gráficos de los brokers mezclan, y por la que un depósito parece una ganancia." +
        (completo ? "" : ` Acá se mide solo ${desde}, arrancando de cero el primer día del período.`),
    },
    {
      titulo: "TIR anual (XIRR)",
      valor: percent(tir, { decimals: 1 }),
      cuerpo:
        tir === null && periodo && !periodo.full && periodo.days < 90
          ? `La misma idea, anualizada: qué tasa anual habría dado el mismo resultado, teniendo en cuenta cuándo entró cada aporte. Con ${periodo.days} días de período no se muestra: estirar eso a un año da un número de tres cifras que no dice nada. Elegí una ventana más larga y aparece.`
          : "La misma idea, anualizada y desde el punto de vista del aportante: qué tasa anual habría dado el mismo resultado, teniendo en cuenta cuándo entró cada aporte. Si aportaste fuerte justo antes de una subida, va a dar más alta que el rendimiento real. Las dos son correctas; contestan preguntas distintas.",
    },
  ];

  const riesgo = [
    {
      titulo: "Volatilidad anual",
      valor: percent(p.metrics.volatility, { decimals: 0, sign: false }),
      cuerpo:
        "Cuánto se mueve la cartera en un año típico, para arriba y para abajo. No es una predicción: mide qué tan accidentado fue el recorrido.",
    },
    {
      titulo: "Peor caída",
      valor: percent(p.metrics.maxDrawdown.value, { decimals: 1 }),
      cuerpo: p.metrics.maxDrawdown.from
        ? `La caída más grande desde un pico hasta el fondo, entre ${p.metrics.maxDrawdown.from} y ${p.metrics.maxDrawdown.to}. Sirve para dimensionar cuánta caída soportó la cartera en la práctica.`
        : "La caída más grande desde un pico hasta el fondo.",
    },
  ];

  return (
    <Sheet open={open} onClose={onClose} title="Cómo se calcula">
      <p className="label mb-4 leading-relaxed">
        Todo en dólares. Los números salen únicamente de los movimientos cargados y
        de los precios de mercado: no hay nada estimado. Los cuatro de arriba son{" "}
        <strong style={{ color: "var(--color-ink)" }}>{desde}</strong>, la ventana que
        elegiste en el gráfico.
      </p>

      <div className="space-y-3">
        {entradas.map((item) => (
          <section key={item.titulo} className="card p-3">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <h3 className="text-[13px] font-semibold">{item.titulo}</h3>
              <span className="num shrink-0 text-[13px]">{item.valor}</span>
            </div>
            <p className="text-[12px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
              {item.cuerpo}
            </p>
          </section>
        ))}
      </div>

      {(p.metrics.volatility !== null || p.metrics.maxDrawdown.value < 0) && (
        <>
          <div className="eyebrow mb-2 mt-5">Riesgo</div>
          <div className="space-y-3">
            {riesgo.map((item) => (
              <section key={item.titulo} className="card p-3">
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <h3 className="text-[13px] font-semibold">{item.titulo}</h3>
                  <span className="num shrink-0 text-[13px]">{item.valor}</span>
                </div>
                <p className="text-[12px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
                  {item.cuerpo}
                </p>
              </section>
            ))}
          </div>
        </>
      )}

      <div className="eyebrow mb-2 mt-5">Letra chica</div>
      <ul className="card divide-hairline">
        {[
          ["Costo de las posiciones", "Promedio ponderado, con la comisión adentro. No es FIFO: para impuestos puede no coincidir."],
          ["Pesos", "Se convierten al dólar MEP de cada fecha, o al que hayas cargado en la operación, que tiene prioridad."],
          ["Sin precio", "Si falta la cotización de un activo, se valúa al costo y la app lo indica. Preferimos subestimar antes que estimar."],
          ["Antigüedad", `La cartera tiene ${p.metrics.ageDays} días de historia. Con menos de dos o tres meses, la volatilidad y la TIR son ruido más que señal.`],
        ].map(([titulo, cuerpo]) => (
          <li key={titulo} className="p-3">
            <div className="text-[12px] font-medium">{titulo}</div>
            <div className="label mt-1 leading-snug">{cuerpo}</div>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
