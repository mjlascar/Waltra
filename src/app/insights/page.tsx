"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/ui/Header";
import { SectionTitle } from "@/components/ui/Stat";
import { useStore, newId } from "@/lib/store";
import { longDate, percent, relativeTime } from "@/lib/format";
import { daysBetween, toDay, today } from "@/lib/date";
import type { InsightReport, InsightSignal } from "@/lib/types";

/** Cada recomendacion lleva su etiqueta escrita: el color nunca va solo. */
const ACTION_STYLE: Record<InsightSignal["action"], { color: string; label: string }> = {
  acumular: { color: "var(--color-pos)", label: "Acumular" },
  mantener: { color: "var(--color-ink-2)", label: "Mantener" },
  reducir: { color: "var(--color-warn)", label: "Reducir" },
  vender: { color: "var(--color-neg)", label: "Vender" },
  vigilar: { color: "var(--color-s1)", label: "Vigilar" },
};

export default function Insights() {
  const { portfolio: p, transactions, accounts, settings, insights, saveInsight, apiHeaders, ready } =
    useStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [index, setIndex] = useState(0);
  const [config, setConfig] = useState<{ aiConfigured: boolean; model: string } | null>(null);

  // Preguntamos una sola vez si hay clave cargada, para no ofrecer un boton
  // que solo puede terminar en error.
  useEffect(() => {
    let alive = true;
    fetch("/api/health?light=1", { headers: apiHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => alive && data && setConfig({ aiConfigured: data.aiConfigured, model: data.model }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [apiHeaders]);

  const report = insights[index] ?? null;

  /** Primer dia con posicion en cada activo, para decir hace cuanto lo tiene. */
  const heldSince = useMemo(() => {
    const out: Record<string, string> = {};
    for (const tx of transactions) {
      if (tx.type !== "buy" || !tx.assetId) continue;
      const day = toDay(tx.date);
      if (!out[tx.assetId] || day < out[tx.assetId]) out[tx.assetId] = day;
    }
    return out;
  }, [transactions]);

  async function generate() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const now = today();
      const body = {
        holdings: p.positions.map((pos) => ({
          symbol: pos.symbol,
          name: pos.name,
          kind: pos.kind,
          weightPct: pos.weight * 100,
          valueUsd: pos.valueUsd,
          costUsd: pos.costUsd,
          returnPct: pos.unrealizedPct === null ? null : pos.unrealizedPct * 100,
          heldDays: heldSince[pos.assetId] ? daysBetween(heldSince[pos.assetId], now) : 0,
          account:
            accounts.find((a) => a.id === pos.accounts[0]?.accountId)?.name ?? undefined,
        })),
        totals: {
          valueUsd: p.totalValueUsd,
          contributedUsd: p.netContributedUsd,
          cashUsd: p.cashUsd,
          pnlUsd: p.totalPnlUsd,
          twrPct: p.metrics.twrCumulative === null ? null : p.metrics.twrCumulative * 100,
          xirrPct: p.metrics.xirr === null ? null : p.metrics.xirr * 100,
          volatilityPct: p.metrics.volatility === null ? null : p.metrics.volatility * 100,
          maxDrawdownPct: p.metrics.maxDrawdown.value * 100,
          ageDays: p.metrics.ageDays,
        },
        behaviour: {
          transactions: transactions.length,
          depositsLast90d: transactions.filter(
            (t) => t.type === "deposit" && daysBetween(toDay(t.date), now) <= 90,
          ).length,
          tradesLast90d: transactions.filter(
            (t) => (t.type === "buy" || t.type === "sell") && daysBetween(toDay(t.date), now) <= 90,
          ).length,
          avgDepositUsd: (() => {
            const deposits = transactions.filter((t) => t.type === "deposit");
            if (!deposits.length) return null;
            return p.depositedUsd / deposits.length;
          })(),
          accounts: accounts.map((a) => a.name),
        },
        profile: {
          riskProfile: settings.riskProfile,
          horizonYears: settings.horizonYears,
          goals: settings.goals.slice(0, 600),
        },
        question: question.trim() || undefined,
        model: settings.model,
      };

      const res = await fetch("/api/insights", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify(body),
      });
      // Un 504 casi siempre es el limite de tiempo del hosting, no un
      // problema del modelo: decirlo evita que alguien reintente diez veces.
      if (res.status === 504 || res.status === 408) {
        throw new Error(
          "El servidor cortó la conexión antes de que terminara el análisis. " +
            "Suele pasar en planes con límite de 60 segundos: probá con un modelo " +
            "más rápido desde Ajustes, o corré la app en tu red.",
        );
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      const saved: InsightReport = {
        id: newId(),
        createdAt: data.createdAt ?? new Date().toISOString(),
        model: data.model ?? "—",
        marketBrief: data.marketBrief ?? "",
        signals: data.signals ?? [],
        profileRead: data.profileRead ?? { summary: "", observations: [], risks: [], suggestions: [] },
        sources: data.sources ?? [],
        degraded: Boolean(data.degraded),
        portfolioDigest: data.portfolioDigest ?? "",
      };
      await saveInsight(saved);
      setIndex(0);
      setQuestion("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  if (!ready) return <div className="py-20 text-center"><span className="label">Abriendo…</span></div>;

  return (
    <div className="pb-6">
      <Header title="Insights" />

      {p.positions.length === 0 ? (
        <div className="card p-4">
          <p className="text-[13px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
            El análisis se arma sobre tus posiciones. Cargá al menos una compra y volvé.
          </p>
        </div>
      ) : (
        <>
          <div className="card mb-4 p-3">
            <div className="eyebrow mb-2">Análisis del mercado sobre tu cartera</div>
            <p className="mb-3 text-[12px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
              Busca noticias de las últimas dos semanas sobre tus {p.positions.length} posiciones,
              las cruza con cómo venís operando y devuelve una lectura con fuentes.
            </p>
            <input
              className="input mb-2"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="¿Algo puntual que quieras preguntar? (opcional)"
              maxLength={300}
            />
            <button
              className="btn btn-primary w-full"
              onClick={generate}
              disabled={loading || config?.aiConfigured === false}
            >
              {loading ? "Analizando… puede tardar un minuto" : "Generar análisis"}
            </button>
            {config && (
              <p className="label mt-2 leading-snug">
                {config.aiConfigured
                  ? `Usa ${config.model}. Cada análisis consume créditos de tu cuenta de Anthropic.`
                  : "Falta configurar ANTHROPIC_API_KEY en el servidor. El resto de la app funciona igual; está explicado en el README."}
              </p>
            )}
          </div>

          {error && (
            <div className="card mb-4 p-3" style={{ borderColor: "var(--color-neg)" }}>
              <p className="text-[12px] leading-snug neg">{error}</p>
              {error.includes("ANTHROPIC_API_KEY") && (
                <p className="label mt-2 leading-snug">
                  Los insights necesitan tu propia clave de Anthropic en el servidor. Está
                  explicado en el README; el resto de la app funciona igual sin ella.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {insights.length > 1 && (
        <div className="no-scrollbar mb-3 flex gap-1.5 overflow-x-auto pb-1">
          {insights.map((r, i) => (
            <button
              key={r.id}
              className="chip shrink-0"
              style={{
                height: 28,
                background: i === index ? "var(--color-surface-3)" : "transparent",
                color: i === index ? "var(--color-ink)" : undefined,
                textTransform: "none",
                letterSpacing: 0,
              }}
              onClick={() => setIndex(i)}
            >
              {relativeTime(r.createdAt)}
            </button>
          ))}
        </div>
      )}

      {report && (
        <article>
          <p className="eyebrow mb-3">
            {longDate(report.createdAt.slice(0, 10))} · {report.model}
          </p>

          {report.degraded && (
            <p className="label mb-3 leading-relaxed" style={{ color: "var(--color-warn)" }}>
              El análisis se completó pero no se pudo separar en secciones. Abajo está
              el informe tal como salió.
            </p>
          )}

          {report.marketBrief && (
            <section className="card mb-4 p-3">
              <div className="eyebrow mb-2">El contexto</div>
              <p className="text-[13px] leading-relaxed">{report.marketBrief}</p>
            </section>
          )}

          {report.signals.length > 0 && (
            <section className="mb-4">
              <SectionTitle>Posición por posición</SectionTitle>
              <div className="space-y-2">
                {report.signals.map((signal, i) => {
                  const style = ACTION_STYLE[signal.action] ?? ACTION_STYLE.vigilar;
                  return (
                    <div key={`${signal.symbol}-${i}`} className="card p-3">
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="swatch" style={{ background: style.color }} />
                        <span className="text-[14px] font-semibold">{signal.symbol}</span>
                        <span className="chip" style={{ borderColor: style.color, color: style.color }}>
                          {style.label}
                        </span>
                        <span className="label ml-auto shrink-0">confianza {signal.confidence}</span>
                      </div>
                      <p className="mb-1.5 text-[13px] font-medium leading-snug">{signal.headline}</p>
                      <p className="text-[12px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
                        {signal.rationale}
                      </p>
                      {signal.horizon && (
                        <p className="label mt-2">Horizonte: {signal.horizon}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {report.profileRead.summary && (
          <section className="mb-4">
            <SectionTitle>Cómo invertís en los hechos</SectionTitle>
            <div className="card p-3">
              <p className="mb-3 text-[13px] leading-relaxed">{report.profileRead.summary}</p>
              {(
                [
                  ["Lo que se ve", report.profileRead.observations],
                  ["Riesgos", report.profileRead.risks],
                  ["Para considerar", report.profileRead.suggestions],
                ] as [string, string[]][]
              )
                .filter(([, items]) => items?.length)
                .map(([title, items]) => (
                  <div key={title} className="hairline pt-3 mt-3 first:mt-0 first:border-0 first:pt-0">
                    <div className="eyebrow mb-2">{title}</div>
                    <ul className="space-y-1.5">
                      {items.map((item, i) => (
                        <li
                          key={i}
                          className="flex gap-2 text-[12px] leading-relaxed"
                          style={{ color: "var(--color-ink-2)" }}
                        >
                          <span style={{ color: "var(--color-ink-3)" }}>—</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          </section>
          )}

          {report.sources.length > 0 && (
            <section className="mb-4">
              <SectionTitle>Fuentes</SectionTitle>
              <div className="card divide-hairline">
                {report.sources.map((source, i) => (
                  <a
                    key={i}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-3"
                  >
                    <div className="truncate text-[12px]">{source.title}</div>
                    <div className="label mt-0.5 truncate">{source.url}</div>
                  </a>
                ))}
              </div>
            </section>
          )}

          <p className="label leading-relaxed">
            Esto es una lectura generada por un modelo a partir de búsquedas públicas y de tus
            propios números. No es asesoramiento financiero: verificá las fuentes antes de
            operar. Tu perfil declarado se ajusta en{" "}
            <Link href="/ajustes" className="underline">
              Ajustes
            </Link>
            .
          </p>
        </article>
      )}

      {!report && p.positions.length > 0 && !loading && (
        <p className="label py-8 text-center leading-relaxed">
          Todavía no generaste ningún análisis.
          <br />
          Los informes quedan guardados en el teléfono.
        </p>
      )}

      {p.metrics.ageDays < 60 && p.positions.length > 0 && (
        <p className="label mt-4 leading-relaxed">
          Ojo: tu cartera tiene {p.metrics.ageDays} días. Con tan poca historia, métricas como
          la volatilidad ({percent(p.metrics.volatility, { decimals: 0 })}) son ruido más que
          señal.
        </p>
      )}
    </div>
  );
}
