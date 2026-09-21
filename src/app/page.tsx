"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Header } from "@/components/ui/Header";
import { Notice } from "@/components/ui/Notice";
import { SectionTitle, Stat } from "@/components/ui/Stat";
import { Segmented } from "@/components/ui/Field";
import { ValueChart } from "@/components/charts/ValueChart";
import { Allocation } from "@/components/charts/Allocation";
import { IconChevron } from "@/components/icons";
import { useStore } from "@/lib/store";
import { money, percent, shortDate, TX_SHORT } from "@/lib/format";
import { rangeStart, type RangeKey } from "@/lib/date";
import { EmptyStart } from "@/components/EmptyStart";

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "6M", label: "6M" },
  { value: "1A", label: "1A" },
  { value: "YTD", label: "Año" },
  { value: "MAX", label: "Todo" },
];

export default function Overview() {
  const { portfolio: p, transactions, accounts, assets, sync, ready } = useStore();
  const [range, setRange] = useState<RangeKey>("MAX");

  const chartData = useMemo(() => {
    if (!p.hasData || !p.firstDay) return [];
    const from = rangeStart(range, p.firstDay, p.asOf);
    const contributions = new Map(p.contributions.map((c) => [c.day, c.value]));
    return p.daily
      .filter((d) => d.day >= from)
      .map((d) => ({ day: d.day, value: d.nav, contributed: contributions.get(d.day) ?? 0 }));
  }, [p, range]);

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

  const pnlTone = p.totalPnlUsd >= 0 ? "pos" : "neg";

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
          No pude actualizar los precios: {sync.message}. Lo que ves es el último dato
          guardado.
        </Notice>
      )}
      {p.fxMissing && (
        <Notice>
          No pude traer el dólar MEP, así que los montos en pesos todavía no están
          contados en los totales. Tocá actualizar cuando tengas señal.
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
        <div className="eyebrow mb-2">Valor total · {accounts.length} cuentas</div>
        <div className="hero-num">{money(p.totalValueUsd, "USD")}</div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className={`num text-[15px] ${pnlTone}`}>
            {money(p.totalPnlUsd, "USD", { sign: true })}
          </span>
          <span className={`num text-[13px] ${pnlTone}`}>
            {percent(p.simpleReturn, { decimals: 1 })}
          </span>
          <span className="label">sobre el capital que pusiste</span>
        </div>
      </section>

      <section className="card mb-4 p-3">
        <div className="mb-3">
          <Segmented value={range} onChange={setRange} options={RANGES} />
        </div>
        <ValueChart data={chartData} />
      </section>

      {/* Las cuatro metricas que contestan "como me fue" sin ambiguedad. */}
      <section className="card mb-4 grid grid-cols-2" style={{ gap: 1, background: "var(--color-line)" }}>
        <div style={{ background: "var(--color-surface)" }}>
          <Stat label="Capital aportado" value={money(p.netContributedUsd, "USD", { compact: true })} />
        </div>
        <div style={{ background: "var(--color-surface)" }}>
          <Stat
            label="Ganancia"
            value={money(p.totalPnlUsd, "USD", { compact: true, sign: true })}
            tone={pnlTone}
          />
        </div>
        <div style={{ background: "var(--color-surface)" }}>
          <Stat
            label="Rendimiento real"
            value={percent(p.metrics.twrCumulative, { decimals: 1 })}
            tone={
              p.metrics.twrCumulative === null
                ? "plain"
                : p.metrics.twrCumulative >= 0
                  ? "pos"
                  : "neg"
            }
            hint="el momento del aporte no lo afecta"
          />
        </div>
        <div style={{ background: "var(--color-surface)" }}>
          <Stat
            label="TIR anual"
            value={percent(p.metrics.xirr, { decimals: 1 })}
            tone={p.metrics.xirr === null ? "plain" : p.metrics.xirr >= 0 ? "pos" : "neg"}
            hint="tu plata, anualizada"
          />
        </div>
      </section>

      <section className="mb-5">
        <SectionTitle>Dónde está la plata</SectionTitle>
        <div className="card divide-hairline">
          {p.accountViews
            .filter((a) => a.valueUsd > 0.01 || a.netContributedUsd !== 0)
            .sort((a, b) => b.valueUsd - a.valueUsd)
            .map((account) => (
              <div key={account.accountId} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{account.name}</div>
                  <div className="label mt-0.5">
                    {money(account.investedUsd, "USD", { compact: true })} invertido ·{" "}
                    {money(account.cashUsd, "USD", { compact: true })} líquido
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="num text-[14px]">{money(account.valueUsd, "USD", { compact: true })}</div>
                  <div className={`num text-[11px] ${account.pnlUsd >= 0 ? "pos" : "neg"}`}>
                    {money(account.pnlUsd, "USD", { compact: true, sign: true })}
                    {account.pnlPct !== null && ` · ${percent(account.pnlPct, { decimals: 0 })}`}
                  </div>
                </div>
              </div>
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
              Además tenés {money(p.cashUsd, "USD")} sin invertir
              {p.totalValueUsd > 0 && ` (${percent(p.cashUsd / p.totalValueUsd, { decimals: 0, sign: false })} del total)`}.
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
    </div>
  );
}
