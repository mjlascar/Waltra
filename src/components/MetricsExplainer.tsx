"use client";

import { Sheet } from "@/components/ui/Sheet";
import { money, percent } from "@/lib/format";
import type { Portfolio } from "@/lib/engine/portfolio";

/**
 * Qué significa cada número, con los números del usuario adentro.
 *
 * La queja que origino la app fue "las metricas se mezclan y confunden". Una
 * definicion generica de TWR no resuelve eso; verla aplicada a la propia
 * cartera, si.
 */
export function MetricsExplainer({
  portfolio: p,
  open,
  onClose,
}: {
  portfolio: Portfolio;
  open: boolean;
  onClose: () => void;
}) {
  const entradas = [
    {
      titulo: "Capital aportado",
      valor: money(p.netContributedUsd, "USD"),
      cuerpo: `Todo lo que ingresaste menos todo lo que retiraste: ${money(p.depositedUsd, "USD")} de ingresos y ${money(p.withdrawnUsd, "USD")} de retiros. Transferir de Cocos a Binance no suma acá: no es capital nuevo, solo cambia de lugar. Comprar tampoco: convertís efectivo en un activo, pero el patrimonio es el mismo.`,
    },
    {
      titulo: "Ganancia",
      valor: money(p.totalPnlUsd, "USD", { sign: true }),
      cuerpo: `Lo que vale hoy la cartera (${money(p.totalValueUsd, "USD")}) menos el capital aportado (${money(p.netContributedUsd, "USD")}). Incluye lo que subieron tus posiciones${p.realizedUsd !== 0 ? `, lo que ya realizaste al vender (${money(p.realizedUsd, "USD", { sign: true })})` : ""}${p.incomeUsd > 0 ? ` y lo que cobraste en dividendos e intereses (${money(p.incomeUsd, "USD")})` : ""}${p.feesUsd > 0 ? `, descontando ${money(p.feesUsd, "USD")} de comisiones` : ""}.`,
    },
    {
      titulo: "Rendimiento real (TWR)",
      valor: percent(p.metrics.twrCumulative, { decimals: 1 }),
      cuerpo:
        "Qué tan bien elegiste, sin que el momento de los aportes distorsione el número. Se encadenan los retornos de cada día neutralizando las entradas y salidas: si aportás 1.000 dólares nuevos, el valor sube pero el rendimiento no se mueve. Es la métrica que los gráficos de los brokers mezclan, y por la que un depósito parece una ganancia.",
    },
    {
      titulo: "TIR anual (XIRR)",
      valor: percent(p.metrics.xirr, { decimals: 1 }),
      cuerpo:
        "La misma idea, anualizada y desde el punto de vista del aportante: qué tasa anual habría dado el mismo resultado, teniendo en cuenta cuándo entró cada aporte. Si aportaste fuerte justo antes de una subida, va a dar más alta que el rendimiento real. Las dos son correctas; contestan preguntas distintas.",
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
        de los precios de mercado: no hay nada estimado.
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
