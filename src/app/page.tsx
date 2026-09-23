"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Header } from "@/components/ui/Header";
import { Notice } from "@/components/ui/Notice";
import { SectionTitle, Stat } from "@/components/ui/Stat";
import { Segmented } from "@/components/ui/Field";
import { ValueChart } from "@/components/charts/ValueChart";
import { ReturnChart } from "@/components/charts/ReturnChart";
import { Allocation } from "@/components/charts/Allocation";
import { IconChevron } from "@/components/icons";
import { useStore } from "@/lib/store";
import { money, percent, shortDate, TX_SHORT } from "@/lib/format";
import { rangeStart, type RangeKey } from "@/lib/date";
import type { AccountView } from "@/lib/engine/portfolio";
import { periodView } from "@/lib/engine/period";
import { BENCHMARK_ASSET_ID, BENCHMARK_CHOICES, benchmarkReturns } from "@/lib/benchmark";
import { getDb } from "@/lib/db";
import { useLiveQuery } from "dexie-react-hooks";
import { EmptyStart } from "@/components/EmptyStart";
import { MetricsExplainer } from "@/components/MetricsExplainer";
import { AccountSheet } from "@/components/AccountSheet";

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "7D", label: "7D" },
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "6M", label: "6M" },
  { value: "1A", label: "1A" },
  { value: "YTD", label: "Año" },
  { value: "MAX", label: "Todo" },
];

/**
 * Como se lee la ventana elegida, para que los numeros de abajo digan de que
 * periodo hablan. Sin esto, cambiar el rango movia el grafico y dejaba las
 * metricas quietas, como si la ganancia del mes fuera la de siempre.
 */
const RANGE_LABEL: Record<RangeKey, string> = {
  "7D": "en los últimos 7 días",
  "1M": "en el último mes",
  "3M": "en los últimos 3 meses",
  "6M": "en los últimos 6 meses",
  "1A": "en el último año",
  YTD: "en lo que va del año",
  MAX: "desde el primer movimiento",
};

type ChartMode = "valor" | "rendimiento";

export default function Overview() {
  const { portfolio: p, transactions, accounts, assets, settings, sync, ready } = useStore();
  // Un mes por defecto y no todo el historial: al abrir la app lo que se
  // quiere saber es como viene esto, no como viene desde el principio. El
  // historico sigue a un toque.
  const [range, setRange] = useState<RangeKey>("1M");
  const [mode, setMode] = useState<ChartMode>("valor");
  const [explaining, setExplaining] = useState(false);
  const [account, setAccount] = useState<AccountView | null>(null);
  const db = getDb();

  const from = useMemo(
    () => (p.firstDay ? rangeStart(range, p.firstDay, p.asOf) : null),
    [range, p.firstDay, p.asOf],
  );

  const chartData = useMemo(() => {
    if (!p.hasData || !from) return [];
    const contributions = new Map(p.contributions.map((c) => [c.day, c.value]));
    const puntos = p.daily
      .filter((d) => d.day >= from)
      .map((d) => ({ day: d.day, value: d.nav, contributed: contributions.get(d.day) ?? 0 }));
    // El último punto de la serie se valúa con el cierre guardado, pero el
    // total de arriba usa la cotización en vivo. Con las dos cosas en la misma
    // pantalla, la diferencia se lee como un error: el gráfico termina donde
    // termina el número grande.
    const ultimo = puntos[puntos.length - 1];
    if (ultimo && ultimo.day === p.asOf) ultimo.value = p.totalValueUsd;
    return puntos;
  }, [p, from]);

  /**
   * Rendimiento dentro de la ventana elegida: se reindexa al primer dia del
   * rango, asi "3M" muestra lo que pasó en esos tres meses y no el acumulado
   * desde siempre recortado.
   */
  const returnData = useMemo(() => {
    if (!from || p.twr.length === 0) return [];
    const window = p.twr.filter((point) => point.day >= from);
    if (window.length === 0) return [];
    const base = window[0].index;
    if (base <= 0) return [];
    return window.map((point) => ({ day: point.day, value: point.index / base - 1 }));
  }, [p.twr, from]);

  /**
   * Lo que pasó dentro de la ventana elegida. Es `null` mientras no hay
   * historia; con la ventana completa devuelve los mismos números de siempre,
   * y hay un test del motor que lo fija.
   */
  const periodo = useMemo(
    () => (from ? periodView(p.daily, p.twr, from) : null),
    [p.daily, p.twr, from],
  );

  const benchmarkSeries = useLiveQuery(
    async () => (db ? db.priceSeries.get(BENCHMARK_ASSET_ID) : undefined),
    [db],
  );

  const compare = useMemo(() => {
    if (settings.benchmark === "none" || returnData.length === 0) return undefined;
    const points = benchmarkReturns(
      benchmarkSeries,
      returnData.map((point) => point.day),
    );
    if (!points) return undefined;
    const choice = BENCHMARK_CHOICES.find((c) => c.value === settings.benchmark);
    return {
      label: choice?.label ?? settings.benchmark ?? "Referencia",
      color: "var(--color-s4)",
      points,
    };
  }, [settings.benchmark, benchmarkSeries, returnData]);

  /** La conclusión en palabras: le ganaste al índice, o no. */
  const verdict = useMemo(() => {
    if (!compare || returnData.length === 0) return null;
    const mine = returnData[returnData.length - 1].value;
    const theirs = compare.points[compare.points.length - 1].value;
    const gap = mine - theirs;
    if (Math.abs(gap) < 0.005) {
      return { text: `Empataste con el ${compare.label}.`, tone: "plain" as const };
    }
    // La diferencia entre dos porcentajes se mide en puntos, no en por ciento.
    const puntos = (Math.abs(gap) * 100).toLocaleString("es-AR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return {
      text:
        gap > 0
          ? `Le ganaste al ${compare.label} por ${puntos} puntos.`
          : `El ${compare.label} te ganó por ${puntos} puntos.`,
      tone: gap > 0 ? ("pos" as const) : ("neg" as const),
    };
  }, [compare, returnData]);

  const recent = useMemo(
    () =>
      [...transactions]
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
        .slice(0, 4),
    [transactions],
  );

  const slices = useMemo(
    () =>
      p.positions.map((pos) => ({
        key: pos.assetId,
        label: pos.symbol,
        value: pos.valueUsd,
        sub: pos.name !== pos.symbol ? undefined : undefined,
      })),
    [p.positions],
  );

  if (!ready) {
    return (
      <div className="py-20 text-center">
        <span className="label">Abriendo…</span>
      </div>
    );
  }

  if (!p.hasData) return <EmptyStart />;

  // Con la ventana completa el periodo y la historia son lo mismo, pero el
  // encuadre cambia: ahi vale "sobre el capital que pusiste", que es la
  // pregunta de fondo de la app.
  const completo = !periodo || periodo.full;
  const pnl = completo ? p.totalPnlUsd : periodo.pnlUsd;
  const pnlTone = pnl >= 0 ? "pos" : "neg";
  const desde = completo ? RANGE_LABEL.MAX : RANGE_LABEL[range];
  const capitalPeriodo = completo ? p.netContributedUsd : periodo.contributedUsd;
  const twrPeriodo = completo ? p.metrics.twrCumulative : periodo.twr;
  // La TIR de siempre esta anualizada sobre toda la historia; la de una
  // ventana corta se deja sin mostrar antes que estirar una semana a un anio.
  const xirrPeriodo = completo ? p.metrics.xirr : periodo.xirr;
  // Solo cuentan las cuentas que tienen algo: decir "2 cuentas" cuando una
  // esta vacia es ruido.
  /**
   * Cuentas con el efectivo en negativo.
   *
   * No rompe ningun numero —el saldo negativo cancela el activo de mas y la
   * ganancia sigue siendo la correcta— pero describe algo que no pudo pasar,
   * asi que la app lo dice en vez de dejarlo escondido en un renglon.
   */
  const enDescubierto = p.accountViews.filter((a) => a.cashUsd < -0.01);

  const activas = p.accountViews.filter(
    (a) => a.valueUsd > 0.01 || a.netContributedUsd !== 0,
  ).length;

  return (
    <div className="pb-6">
      <Header title="Resumen" />

      {sync.status === "ok" && sync.mock && (
        <Notice>
          Precios simulados (WALTRA_MOCK=1). Sirven para probar la interfaz; no son
          cotizaciones reales.
        </Notice>
      )}
      {sync.status === "error" && (
        <Notice>
          No se pudieron actualizar los precios: {sync.message}. Lo que ves es el último
          dato guardado.
        </Notice>
      )}
      {sync.status === "ok" && sync.down.length > 0 && (
        <Notice>
          {sync.down.length === 1 ? "No responde " : "No responden "}
          <strong>{sync.down.join(" ni ")}</strong>. Son fuentes públicas y gratuitas:
          suelen volver solas. Mientras tanto, esas posiciones se valúan con el último
          precio guardado.
        </Notice>
      )}
      {p.fxMissing && (
        <Notice>
          No pude traer el dólar MEP, así que los montos en pesos todavía no están
          contados en los totales. Tocá actualizar cuando tengas señal.
        </Notice>
      )}
      {enDescubierto.length > 0 && (
        <Notice>
          {enDescubierto.length === 1 ? "La cuenta " : "Las cuentas "}
          <strong>{enDescubierto.map((v) => v.name).join(" y ")}</strong>{" "}
          {enDescubierto.length === 1 ? "queda" : "quedan"} con efectivo en negativo:
          hay compras por más plata de la que figura ingresada. Los totales no se
          inflan por eso, pero falta cargar algún ingreso o transferencia.
        </Notice>
      )}
      {p.missingPrices.length > 0 && (
        <Notice>
          Sin cotización para {p.missingPrices.join(", ")}. Esas posiciones están valuadas
          al costo, así que la ganancia real puede ser distinta.
        </Notice>
      )}

      {/* El numero protagonista de la app: cuanto tenes en total. */}
      <section className="mb-5">
        <div className="eyebrow mb-2">
          Valor total{activas > 1 ? ` · ${activas} cuentas` : ""}
        </div>
        <div className="hero-num">{money(p.totalValueUsd, "USD")}</div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
          <span className={`num text-[15px] ${pnlTone}`}>
            {money(pnl, "USD", { sign: true })}
          </span>
          <span className={`num text-[13px] ${pnlTone}`}>
            {percent(completo ? p.simpleReturn : periodo.twr, { decimals: 1 })}
          </span>
          <span className="label">
            {completo ? "sobre el capital que pusiste" : desde}
          </span>
        </div>
      </section>

      <section className="card mb-4 p-3">
        <div className="mb-2">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "valor", label: "Valor" },
              { value: "rendimiento", label: "Rendimiento" },
            ]}
          />
        </div>
        <div className="mb-3">
          <Segmented value={range} onChange={setRange} options={RANGES} />
        </div>

        {mode === "valor" ? (
          <ValueChart data={chartData} />
        ) : (
          <>
            <ReturnChart data={returnData} compare={compare} height={186} tone="var(--color-s1)" />
            {verdict && (
              <p
                className={`mt-2 text-[13px] font-medium ${
                  verdict.tone === "pos" ? "pos" : verdict.tone === "neg" ? "neg" : ""
                }`}
              >
                {verdict.text}
              </p>
            )}
            <p className="label mt-1.5 leading-snug">
              Rendimiento sin contar cuándo pusiste la plata.
              {compare
                ? " La referencia es lo que habrías conseguido comprando el índice el primer día del período."
                : ""}
            </p>
          </>
        )}
      </section>

      {/* Las cuatro metricas que contestan "como me fue" sin ambiguedad, en la
          ventana que se eligio arriba. Todo el bloque abre la explicacion: son
          numeros que solo sirven si se entiende que mide cada uno. */}
      <div className="eyebrow mb-2">Cómo te fue {desde}</div>
      <button
        className="card mb-1 grid w-full grid-cols-2 text-left"
        style={{ gap: 1, background: "var(--color-line)" }}
        onClick={() => setExplaining(true)}
      >
        <div style={{ background: "var(--color-surface)" }}>
          <Stat
            label={completo ? "Capital aportado" : "Capital que entró"}
            value={money(capitalPeriodo, "USD", { compact: true })}
          />
        </div>
        <div style={{ background: "var(--color-surface)" }}>
          <Stat
            label="Ganancia"
            value={money(pnl, "USD", { compact: true, sign: true })}
            tone={pnlTone}
          />
        </div>
        <div style={{ background: "var(--color-surface)" }}>
          <Stat
            label="Rendimiento real"
            value={percent(twrPeriodo, { decimals: 1 })}
            tone={twrPeriodo === null ? "plain" : twrPeriodo >= 0 ? "pos" : "neg"}
            hint="el momento del aporte no lo afecta"
          />
        </div>
        <div style={{ background: "var(--color-surface)" }}>
          <Stat
            label="TIR anual"
            value={percent(xirrPeriodo, { decimals: 1 })}
            tone={xirrPeriodo === null ? "plain" : xirrPeriodo >= 0 ? "pos" : "neg"}
            hint={
              xirrPeriodo === null && periodo && periodo.days < 90
                ? "hace falta un período más largo"
                : "anualizada, según cuándo aportaste"
            }
          />
        </div>
      </button>
      <p className="label mb-5 text-right">
        <button onClick={() => setExplaining(true)} className="underline">
          ¿Cómo se calcula?
        </button>
      </p>

      <section className="mb-5">
        <SectionTitle>Distribución por cuenta</SectionTitle>
        <div className="card divide-hairline">
          {p.accountViews
            .filter((a) => a.valueUsd > 0.01 || a.netContributedUsd !== 0)
            .sort((a, b) => b.valueUsd - a.valueUsd)
            .map((view) => (
              <button
                key={view.accountId}
                onClick={() => setAccount(view)}
                className="flex w-full items-center gap-3 p-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{view.name}</div>
                  <div className="label mt-0.5">
                    {money(view.investedUsd, "USD", { compact: true })} invertido ·{" "}
                    {/* Un saldo negativo se marca donde se lee, no solo en el
                        aviso de arriba: es el renglon que lo explica. */}
                    <span style={view.cashUsd < -0.01 ? { color: "var(--color-warn)" } : undefined}>
                      {money(view.cashUsd, "USD", { compact: true })} líquido
                    </span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="num text-[14px]">{money(view.valueUsd, "USD", { compact: true })}</div>
                  <div className={`num text-[11px] ${view.pnlUsd >= 0 ? "pos" : "neg"}`}>
                    {money(view.pnlUsd, "USD", { compact: true, sign: true })}
                    {view.pnlPct !== null && ` · ${percent(view.pnlPct, { decimals: 0 })}`}
                  </div>
                </div>
                <IconChevron size={13} className="shrink-0" />
              </button>
            ))}
        </div>
      </section>

      <section className="mb-5">
        <SectionTitle
          action={
            <Link href="/cartera" className="label flex items-center gap-0.5">
              Ver cartera <IconChevron size={12} />
            </Link>
          }
        >
          Composición
        </SectionTitle>
        <div className="card p-3">
          <Allocation slices={slices} total={p.investedUsd} />
          {p.cashUsd > 0.01 && (
            <p className="hairline mt-2 pt-2 text-[11px]" style={{ color: "var(--color-ink-3)" }}>
              {money(p.cashUsd, "USD")} sin invertir
              {p.totalValueUsd > 0 && `, un ${percent(p.cashUsd / p.totalValueUsd, { decimals: 0, sign: false })} del total`}.
            </p>
          )}
        </div>
      </section>

      {recent.length > 0 && (
        <section>
          <SectionTitle
            action={
              <Link href="/movimientos" className="label flex items-center gap-0.5">
                Ver todo <IconChevron size={12} />
              </Link>
            }
          >
            Últimos movimientos
          </SectionTitle>
          <div className="card divide-hairline">
            {recent.map((tx) => {
              const asset = assets.find((a) => a.id === tx.assetId);
              return (
                <div key={tx.id} className="flex items-center gap-3 p-3">
                  <span className="chip shrink-0">{TX_SHORT[tx.type]}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {asset?.symbol ?? accounts.find((a) => a.id === tx.accountId)?.name ?? "—"}
                  </span>
                  <span className="label shrink-0">{shortDate(tx.date)}</span>
                  <span className="num shrink-0 text-[13px]">
                    {money(tx.amount, tx.currency, { compact: true })}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <MetricsExplainer
        portfolio={p}
        periodo={periodo}
        desde={desde}
        open={explaining}
        onClose={() => setExplaining(false)}
      />
      <AccountSheet account={account} onClose={() => setAccount(null)} />
    </div>
  );
}
