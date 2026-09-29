"use client";

import { Sheet } from "@/components/ui/Sheet";
import { money, percent, shortDate } from "@/lib/format";
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
  const display = p.base;
  const completo = !periodo || periodo.full;
  const capital = completo ? p.netContributedUsd : periodo.contributedUsd;
  const ganancia = completo ? p.totalPnlUsd : periodo.pnlUsd;
  const rendimiento = completo ? p.metrics.twrCumulative : periodo.twr;
  const tir = completo ? p.metrics.xirr : periodo.xirr;

  // La ganancia, por sus causas. Las comisiones de compra y venta ya estan
  // adentro del costo y del realizado; aca van solo las sueltas. Lo que queda
  // es el tipo de cambio: la liquidez en la otra moneda cambio de valor.
  const causas: [string, number][] = [
    ["Sin realizar", p.unrealizedUsd],
    ["Realizado", p.realizedUsd],
    ["Cobrado", p.incomeUsd],
    ["Comisiones", -p.looseFeesUsd],
  ];
  const resto = p.totalPnlUsd - causas.reduce((acc, [, v]) => acc + v, 0);
  if (Math.abs(resto) >= 0.5) causas.push(["Tipo de cambio", resto]);

  const entradas: { titulo: string; valor: string; cuerpo: string }[] = [
    {
      titulo: completo ? "Capital aportado" : "Ingresos",
      valor: money(capital, display),
      cuerpo: completo
        ? `Ingresos (${money(p.depositedUsd, display)}) menos retiros (${money(p.withdrawnUsd, display)}). Comprar o pasar plata entre tus cuentas no cuenta.`
        : `Ingresos menos retiros ${desde}. Comprar o pasar plata entre tus cuentas no cuenta.`,
    },
    {
      titulo: "Ganancia",
      valor: money(ganancia, display, { sign: true }),
      cuerpo: completo
        ? `Lo que vale la cartera (${money(p.totalValueUsd, display)}) menos el capital aportado.`
        : `Lo que vale hoy menos lo que valía al empezar (${money(periodo.startValueUsd, display)}), sin contar los ${money(periodo.netFlowUsd, display)} que ingresaste en el medio.`,
    },
    {
      titulo: "Rendimiento (TWR)",
      valor: percent(rendimiento, { decimals: 1 }),
      cuerpo:
        "Cuánto rindió lo que elegiste, sin que los aportes lo muevan: un ingreso nuevo sube el valor, no el rendimiento.",
    },
    {
      titulo: "TIR (XIRR)",
      valor: percent(tir, { decimals: 1 }),
      cuerpo:
        tir === null && periodo && !periodo.full && periodo.days < 90
          ? "La tasa anual equivalente. Con menos de 90 días no se muestra: anualizar tan poco da un número sin sentido."
          : "La tasa anual equivalente, según cuándo entró cada aporte. Si aportaste antes de una suba, da más que el TWR.",
    },
  ];

  const riesgo = [
    {
      titulo: "Volatilidad anual",
      valor: percent(p.metrics.volatility, { decimals: 0, sign: false }),
      cuerpo: "Cuánto se mueve la cartera en un año típico.",
    },
    {
      titulo: "Peor caída",
      valor: percent(p.metrics.maxDrawdown.value, { decimals: 1 }),
      cuerpo: p.metrics.maxDrawdown.from
        ? `De un pico al fondo, entre el ${shortDate(p.metrics.maxDrawdown.from, true)} y el ${shortDate(p.metrics.maxDrawdown.to ?? p.metrics.maxDrawdown.from, true)}.`
        : "De un pico al fondo.",
    },
  ];

  return (
    <Sheet open={open} onClose={onClose} title="Cómo se calcula">
      <p className="label mb-4 leading-relaxed">
        Los cuatro números son{" "}
        <strong style={{ color: "var(--color-ink)" }}>{desde}</strong>, la ventana del gráfico.
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

      {/* Desde el principio, la ganancia se arma con estas partes. Sin el
          desglose, sin realizar + realizado no da la ganancia y parece un
          error: faltan lo cobrado, las comisiones y el tipo de cambio. */}
      <div className="eyebrow mb-2 mt-5">De dónde sale la ganancia</div>
      <ul className="card divide-hairline">
        {causas.map(([nombre, valor]) => (
          <li key={nombre} className="flex items-baseline justify-between gap-3 px-3 py-2">
            <span className="text-[12px]">{nombre}</span>
            <span className={`num text-[12px] ${valor > 0 ? "pos" : valor < 0 ? "neg" : ""}`}>
              {money(valor, display, { sign: true })}
            </span>
          </li>
        ))}
        <li className="flex items-baseline justify-between gap-3 px-3 py-2">
          <span className="text-[12px] font-semibold">Ganancia desde el principio</span>
          <span className="num text-[12px] font-semibold">
            {money(p.totalPnlUsd, display, { sign: true })}
          </span>
        </li>
      </ul>
      <p className="label mt-2 leading-snug">
        Realizado es lo que ganaste o perdiste al vender, contra lo que te había costado.
        Cuenta aunque hayas reinvertido la plata: la venta ya pasó, y lo que compraste
        después arranca con su propio costo.
      </p>

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
          ["Costo", "Promedio ponderado, con la comisión adentro."],
          [
            display === "USD" ? "Pesos" : "Dólares",
            "Al dólar MEP de cada fecha, o al que cargaste en la operación.",
          ],
          ["Sin precio", "Se valúa al costo, y la app lo avisa."],
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
