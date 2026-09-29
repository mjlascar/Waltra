"use client";

import { useEffect, useMemo, useState } from "react";
import { Header } from "@/components/ui/Header";
import { SectionTitle } from "@/components/ui/Stat";
import { ExternalReport } from "@/components/ExternalReport";
import { ReportView } from "@/components/insights/ReportView";
import { ScheduleSheet } from "@/components/insights/ScheduleSheet";
import { Sheet } from "@/components/ui/Sheet";
import { IconChevron } from "@/components/icons";
import { addPending, failPending, removePending, usePending } from "@/lib/insights/queue";
import { providerInfo, resolveProvider } from "@/lib/insights/providers";
import { useStore, newId } from "@/lib/store";
import {
  describeBackendError,
  diagnostics,
  insights as insightsRequest,
  ON_DEVICE,
} from "@/lib/backend";
import {
  isDue,
  KIND_DETAIL,
  KIND_LABEL,
  needsFocus,
  schedules,
  type ReportKind,
} from "@/lib/insights/schedule";
import { percent, relativeTime } from "@/lib/format";
import { daysBetween, toDay, today } from "@/lib/date";
import type { InsightReport } from "@/lib/types";
import type { TradeView } from "@/lib/engine/portfolio";
import { MAX_TRADES } from "@/lib/insights/digest";

/**
 * Las compras y ventas de un activo, como viajan al modelo: las mas
 * recientes, y cuantas quedaron afuera. Con fecha, cantidad y precio en
 * dolares; sin notas ni la frase original, que son del usuario.
 */
function historial(trades: TradeView[]) {
  const ultimas = trades.slice(-MAX_TRADES);
  return {
    trades: ultimas.map((t) => ({
      date: t.day,
      side: t.side === "buy" ? ("compra" as const) : ("venta" as const),
      quantity: t.quantity,
      priceUsd: t.priceUsd,
    })),
    olderTrades: trades.length - ultimas.length || undefined,
  };
}


export default function Insights() {
  const {
    portfolioUsd: p, transactions, accounts, settings, insights,
    saveInsight, updateSettings, backend, ready,
  } = useStore();
  const agenda = useMemo(() => schedules(settings), [settings]);
  // `ahora` se congela al montar: si se recalculara en cada render, el aviso
  // de "toca generarlo" podria aparecer y desaparecer solo mientras se mira.
  const ahora = useMemo(() => new Date(), []);
  const pendientes = agenda.filter((a) => isDue(a, ahora));
  const enCurso = usePending();
  const [question, setQuestion] = useState("");
  const [abierto, setAbierto] = useState<InsightReport | null>(null);
  const [agendando, setAgendando] = useState(false);
  const [externo, setExterno] = useState(false);
  const [tipo, setTipo] = useState<ReportKind>("cartera");
  const [foco, setFoco] = useState("");
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


  /**
   * El ultimo informe del mismo tipo, para que el nuevo diga que cambio.
   *
   * Los informes guardados antes de que existieran varias clases no traen
   * tipo; se los toma como de cartera, que es lo que eran.
   */
  function anterior(kind: ReportKind) {
    const previo = insights.find((r) => (r.kind ?? "cartera") === kind && r.portfolioDigest);
    if (!previo) return undefined;
    return {
      createdAt: previo.createdAt,
      digest: previo.portfolioDigest.slice(0, 6000),
      brief: [previo.marketBrief, previo.profileRead?.summary].filter(Boolean).join("\n\n").slice(0, 6000),
    };
  }

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

  /**
   * El resumen que viaja al modelo.
   *
   * Es un memo y no algo que se arme adentro de `generate` porque lo usan dos
   * caminos: el informe que genera la app y el que se copia para hacer afuera.
   * Si se armaran por separado, tarde o temprano dirian cosas distintas.
   */
  const datosCartera = useMemo(() => {
    const now = today();
    return {
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
          quantity: pos.quantity,
          avgCostUsd: pos.avgCostUsd,
          priceUsd: pos.priceUsd,
          realizedUsd: pos.realizedUsd || undefined,
          splits: p.splits[pos.assetId]?.length
            ? p.splits[pos.assetId].map((sp) => ({ date: sp.date, ratio: sp.ratio }))
            : undefined,
          ...historial(pos.trades),
        })),
        // Lo vendido entero tambien viaja: como se salio de una posicion dice
        // tanto sobre como invierte alguien como lo que conserva.
        closed: p.closedPositions.slice(-30).map((c) => ({
          symbol: c.symbol,
          kind: c.kind,
          realizedUsd: c.realizedUsd,
          ...historial(c.trades),
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
    };
  }, [p, transactions, accounts, settings, heldSince]);

  /**
   * Manda un pedido y vuelve enseguida: el pedido queda en la lista de abajo
   * como "analizando" y el formulario sigue libre para otro. Cuando llega, se
   * guarda como un informe mas y se abre desde la lista.
   */
  function generate(kind: ReportKind, pregunta: string, focoPedido: string) {
    const id = newId();
    const q = pregunta.trim() || undefined;
    const f = needsFocus(kind) ? focoPedido.trim() || undefined : undefined;
    addPending({ id, kind, question: q, focus: f, startedAt: new Date().toISOString() });
    const body = {
      ...datosCartera,
      question: q,
      model: settings.model,
      provider: settings.provider,
      kind,
      focus: f,
      // El informe anterior del mismo tipo, si hay. Es lo que la app tiene
      // y un chat cualquiera no: puede decir qué cambió en vez de arrancar
      // de cero cada vez.
      previous: anterior(kind),
    };
    void (async () => {
      try {
        const data = await insightsRequest(body, backend());
        const saved: InsightReport = {
          id: newId(),
          createdAt: data.createdAt ?? new Date().toISOString(),
          model: data.model ?? "—",
          kind,
          question: q,
          focus: f,
          marketBrief: data.marketBrief ?? "",
          signals: data.signals ?? [],
          profileRead: data.profileRead ?? { summary: "", observations: [], risks: [], suggestions: [] },
          sources: data.sources ?? [],
          degraded: Boolean(data.degraded),
          portfolioDigest: data.portfolioDigest ?? "",
        };
        await saveInsight(saved);
        removePending(id);
        // El informe agendado queda marcado como hecho recien cuando salio
        // bien: si fallo, la semana que viene sigue pendiente.
        const agendado = agenda.find((x) => x.kind === kind);
        if (agendado?.enabled) {
          await updateSettings({
            schedules: agenda.map((x) =>
              x.kind === kind ? { ...x, lastRun: new Date().toISOString() } : x,
            ),
          });
        }
      } catch (err) {
        failPending(id, describeBackendError(err));
      }
    })();
  }

  function pedir() {
    generate(tipo, question, foco);
    setQuestion("");
    setFoco("");
  }

  if (!ready) return <div className="py-20 text-center"><span className="label">Abriendo…</span></div>;

  const sinClave = config?.aiConfigured === false;
  const semanal = agenda.find((x) => x.enabled);

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
          {pendientes.map((x) => (
            <div key={x.kind} className="card mb-4 flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="eyebrow mb-1">Te toca</div>
                <p className="text-[13px] font-medium">{KIND_LABEL[x.kind]}</p>
              </div>
              <button
                className="btn btn-primary btn-sm shrink-0"
                onClick={() => generate(x.kind, "", "")}
                disabled={sinClave}
              >
                Generarlo
              </button>
            </div>
          ))}

          <div className="card mb-4 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="eyebrow">Qué querés que analice</span>
              <button
                className="chip shrink-0"
                style={{
                  height: 24,
                  color: semanal ? "var(--color-pos)" : undefined,
                  borderColor: semanal ? "var(--color-pos)" : undefined,
                }}
                onClick={() => setAgendando(true)}
              >
                Informe semanal{semanal ? " · activo" : ""}
              </button>
            </div>
            <ul className="divide-hairline mb-3">
              {(Object.keys(KIND_LABEL) as ReportKind[]).map((k) => (
                <li key={k}>
                  <button
                    className="flex w-full items-start gap-2 py-2 text-left"
                    aria-pressed={k === tipo}
                    onClick={() => setTipo(k)}
                  >
                    <span
                      aria-hidden
                      className="mt-1 shrink-0"
                      style={{
                        width: 8,
                        height: 8,
                        border: "1px solid var(--color-line-strong)",
                        background: k === tipo ? "var(--color-ink)" : "transparent",
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block text-[13px]"
                        style={{ color: k === tipo ? "var(--color-ink)" : "var(--color-ink-2)" }}
                      >
                        {KIND_LABEL[k]}
                      </span>
                      {k === tipo && (
                        <span className="label mt-0.5 block leading-snug">{KIND_DETAIL[k]}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {needsFocus(tipo) &&
              (tipo === "posicion" ? (
                <div className="mb-2">
                  <select
                    className="input"
                    value={foco}
                    onChange={(e) => setFoco(e.target.value)}
                  >
                    <option value="">Elegí la posición…</option>
                    {p.positions.map((pos) => (
                      <option key={pos.assetId} value={pos.symbol}>
                        {pos.symbol}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <input
                  className="input mb-2 num"
                  inputMode="decimal"
                  value={foco}
                  onChange={(e) => setFoco(e.target.value)}
                  placeholder="Cuánta plata tenés para poner, en dólares"
                />
              ))}

            {/* La pregunta no es otro pedido: viaja junto con el analisis
                elegido, y el informe la contesta primero. Antes no quedaba
                claro, y encima no llegaba al modelo. */}
            <span className="eyebrow mb-1.5 mt-1 block">Tu pregunta · opcional</span>
            <textarea
              className="input mb-1"
              rows={2}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ej.: ¿me conviene sumar más BTC ahora?"
              maxLength={300}
            />
            <p className="label mb-3 leading-snug">
              Se suma al análisis de arriba: el informe la contesta primero.
            </p>
            <button
              className="btn btn-primary w-full"
              onClick={pedir}
              disabled={sinClave || (needsFocus(tipo) && !foco.trim())}
            >
              Pedir análisis
            </button>
            {config && (
              <p className="label mt-2 leading-snug">
                {config.aiConfigured
                  ? `Usa ${config.model}. Tarda alrededor de un minuto y consume créditos de tu cuenta; mientras, podés seguir usando la app.`
                  : ON_DEVICE
                    ? `Falta tu clave de ${providerInfo(resolveProvider(settings.provider)).label}: cargala en Ajustes. El resto de la app funciona igual sin ella.`
                    : "Falta configurar ANTHROPIC_API_KEY en el servidor. El resto de la app funciona igual; está explicado en el README."}
              </p>
            )}
          </div>

          {/* Sin clave, el camino que queda: copiar el pedido a un chat y
              traer la respuesta. Con clave no hace falta y solo estorbaba. */}
          {sinClave && (
            <section className="mb-5">
              <SectionTitle>Sin clave de API</SectionTitle>
              <div className="card p-3">
                <p className="label mb-3 leading-relaxed">
                  Si tenés un abono de Claude, ChatGPT o similar, no hay clave que sacar de
                  ahí: esos planes no dan acceso por API. Pero podés copiar el pedido, pegarlo
                  allá y traer la respuesta de vuelta.
                </p>
                <button className="btn btn-sm w-full" onClick={() => setExterno(true)}>
                  Copiar el pedido y pegar el análisis
                </button>
              </div>
            </section>
          )}

          <section className="mb-5">
            <SectionTitle>Tus pedidos</SectionTitle>
            {enCurso.length === 0 && insights.length === 0 ? (
              <p className="label py-6 text-center leading-relaxed">
                Todavía no pediste ningún análisis.
                <br />
                Los informes quedan guardados en el teléfono.
              </p>
            ) : (
              <ul className="card divide-hairline">
                {enCurso.map((x) => (
                  <li key={x.id} className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium">
                        {KIND_LABEL[x.kind]}
                        {x.focus ? ` · ${x.focus}` : ""}
                      </div>
                      {x.question && (
                        <div className="label mt-0.5 truncate">«{x.question}»</div>
                      )}
                      {x.error && <div className="neg mt-1 text-[11px] leading-snug">{x.error}</div>}
                    </div>
                    {x.error ? (
                      <span className="flex shrink-0 gap-1.5">
                        <button
                          className="chip"
                          style={{ height: 26 }}
                          onClick={() => {
                            removePending(x.id);
                            generate(x.kind, x.question ?? "", x.focus ?? "");
                          }}
                        >
                          reintentar
                        </button>
                        <button className="chip" style={{ height: 26 }} onClick={() => removePending(x.id)}>
                          quitar
                        </button>
                      </span>
                    ) : (
                      <span className="label shrink-0">Analizando…</span>
                    )}
                  </li>
                ))}
                {insights.map((r) => (
                  <li key={r.id}>
                    <button
                      className="flex w-full items-center gap-3 p-3 text-left"
                      onClick={() => setAbierto(r)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium">
                          {KIND_LABEL[r.kind ?? "cartera"]}
                          {r.focus ? ` · ${r.focus}` : ""}
                        </div>
                        <div className="label mt-0.5 truncate">
                          {r.question ? `«${r.question}» · ` : ""}
                          {relativeTime(r.createdAt)}
                        </div>
                      </div>
                      <IconChevron size={13} className="shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <ExternalReport
        open={externo}
        onClose={() => setExterno(false)}
        body={p.positions.length > 0 ? { ...datosCartera, kind: "cartera" } : null}
        onSave={async (report) => {
          await saveInsight(report);
        }}
      />
      <ScheduleSheet open={agendando} onClose={() => setAgendando(false)} />
      {abierto && (
        <Sheet open onClose={() => setAbierto(null)} title={KIND_LABEL[abierto.kind ?? "cartera"]}>
          <ReportView report={abierto} />
        </Sheet>
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
