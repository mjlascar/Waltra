"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/ui/Header";
import { SectionTitle } from "@/components/ui/Stat";
import { useStore, newId } from "@/lib/store";
import {
  describeBackendError,
  diagnostics,
  insights as insightsRequest,
  ON_DEVICE,
} from "@/lib/backend";
import {
  describeSchedule,
  isDue,
  KIND_DETAIL,
  DIA_OPCIONES,
  KIND_LABEL,
  schedules,
  type ReportKind,
} from "@/lib/insights/schedule";
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
  const {
    portfolio: p, transactions, accounts, settings, insights,
    saveInsight, updateSettings, backend, ready,
  } = useStore();
  const agenda = useMemo(() => schedules(settings), [settings]);
  // `ahora` se congela al montar: si se recalculara en cada render, el aviso
  // de "toca generarlo" podria aparecer y desaparecer solo mientras se mira.
  const ahora = useMemo(() => new Date(), []);
  const pendientes = agenda.filter((a) => isDue(a, ahora));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [index, setIndex] = useState(0);
  const [config, setConfig] = useState<{ aiConfigured: boolean; model: string } | null>(null);

  // Preguntamos una sola vez si hay clave cargada, para no ofrecer un boton
  // que solo puede terminar en error.
  useEffect(() => {
    let alive = true;
    diagnostics(true, backend())
      .then((data) => alive && setConfig({ aiConfigured: data.aiConfigured, model: data.model }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [backend]);

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

  async function generate(kind: ReportKind = "cartera") {
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
        kind,
      };

      const data = await insightsRequest(body, backend());

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
      // El informe agendado queda marcado como hecho recien cuando salio bien:
      // si fallo, la semana que viene sigue pendiente.
      const agendado = agenda.find((a) => a.kind === kind);
      if (agendado?.enabled) {
        await updateSettings({
          schedules: agenda.map((a) =>
            a.kind === kind ? { ...a, lastRun: new Date().toISOString() } : a,
          ),
        });
      }
    } catch (err) {
      setError(describeBackendError(err));
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
          {/* Lo agendado que ya venció: es lo primero que hay que ver al
              entrar, porque es justamente lo que se vino a buscar. */}
          {pendientes.map((a) => (
            <div
              key={a.kind}
              className="card mb-4 p-3"
              style={{ borderColor: "var(--color-line-strong)" }}
            >
              <div className="eyebrow mb-2">Te toca</div>
              <p className="text-[14px] font-medium">{KIND_LABEL[a.kind]}</p>
              <p className="label mt-1 leading-relaxed">
                {describeSchedule(a)}. {KIND_DETAIL[a.kind]}
              </p>
              <button
                className="btn btn-primary btn-sm mt-3 w-full"
                onClick={() => void generate(a.kind)}
                disabled={loading || config?.aiConfigured === false}
              >
                {loading ? "Analizando…" : "Generarlo ahora"}
              </button>
            </div>
          ))}

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
              onClick={() => void generate("cartera")}
              disabled={loading || config?.aiConfigured === false}
            >
              {loading ? "Analizando… puede tardar un minuto" : "Generar análisis"}
            </button>
            {config && (
              <p className="label mt-2 leading-snug">
                {config.aiConfigured
                  ? `Usa ${config.model}. Cada análisis consume créditos de tu cuenta de Anthropic.`
                  : ON_DEVICE
                    ? "Falta tu clave de Anthropic: cargala en Ajustes. El resto de la app funciona igual sin ella."
                    : "Falta configurar ANTHROPIC_API_KEY en el servidor. El resto de la app funciona igual; está explicado en el README."}
              </p>
            )}
          </div>

          {error && (
            <div className="card mb-4 p-3" style={{ borderColor: "var(--color-neg)" }}>
              <p className="text-[12px] leading-snug neg">{error}</p>
              {error.includes("clave") && (
                <p className="label mt-2 leading-snug">
                  {ON_DEVICE
                    ? "Los insights salen de tu propia cuenta de Anthropic. Cargá la clave en Ajustes; el resto de la app funciona igual sin ella."
                    : "Los insights necesitan una clave de Anthropic en el servidor. Está explicado en el README; el resto de la app funciona igual sin ella."}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* --- Informes agendados ---------------------------------------------- */}
      {p.positions.length > 0 && (
        <section className="mb-5">
          <SectionTitle>Informes que se repiten</SectionTitle>
          <ul className="card divide-hairline">
            {agenda.map((a) => (
              <li key={a.kind} className="p-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">{KIND_LABEL[a.kind]}</div>
                    <div className="label mt-0.5 leading-snug">{KIND_DETAIL[a.kind]}</div>
                  </div>
                  <button
                    className="chip shrink-0"
                    style={{
                      height: 26,
                      color: a.enabled ? "var(--color-pos)" : undefined,
                      borderColor: a.enabled ? "var(--color-pos)" : undefined,
                    }}
                    aria-pressed={a.enabled}
                    onClick={() =>
                      void updateSettings({
                        schedules: agenda.map((x) =>
                          x.kind === a.kind ? { ...x, enabled: !x.enabled } : x,
                        ),
                      })
                    }
                  >
                    {a.enabled ? "activo" : "activar"}
                  </button>
                </div>

                {a.enabled && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <select
                      className="input"
                      value={String(a.weekday)}
                      onChange={(e) =>
                        void updateSettings({
                          schedules: agenda.map((x) =>
                            x.kind === a.kind ? { ...x, weekday: Number(e.target.value) } : x,
                          ),
                        })
                      }
                    >
                      {DIA_OPCIONES.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                    <select
                      className="input"
                      value={String(a.hour)}
                      onChange={(e) =>
                        void updateSettings({
                          schedules: agenda.map((x) =>
                            x.kind === a.kind ? { ...x, hour: Number(e.target.value) } : x,
                          ),
                        })
                      }
                    >
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>
                          {String(h).padStart(2, "0")}:00
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="label mt-2 leading-relaxed">
            {ON_DEVICE
              ? "A la hora elegida llega una notificación y el informe queda acá esperando. No se genera solo: cada análisis gasta créditos de tu cuenta y hacerlo sin que estés mirando es la clase de cosa que se descubre a fin de mes."
              : "El recordatorio con notificación solo existe en el APK. Acá el informe aparece pendiente cuando abrís la app después de la hora elegida."}
          </p>
        </section>
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
