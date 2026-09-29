"use client";

import Link from "next/link";
import { SectionTitle } from "@/components/ui/Stat";
import { longDate } from "@/lib/format";
import { KIND_LABEL } from "@/lib/insights/schedule";
import type { InsightReport, InsightSignal } from "@/lib/types";

/** Cada recomendacion lleva su etiqueta escrita: el color nunca va solo. */
const ACTION_STYLE: Record<InsightSignal["action"], { color: string; label: string }> = {
  acumular: { color: "var(--color-pos)", label: "Acumular" },
  mantener: { color: "var(--color-ink-2)", label: "Mantener" },
  reducir: { color: "var(--color-warn)", label: "Reducir" },
  vender: { color: "var(--color-neg)", label: "Vender" },
  vigilar: { color: "var(--color-s1)", label: "Vigilar" },
};

/**
 * Un informe entero. Se abre desde la lista de pedidos: la pantalla de
 * Insights ya no apila el ultimo informe debajo del formulario, que con el
 * scroll se volvia una sola tira desordenada.
 */
export function ReportView({ report }: { report: InsightReport }) {
  return (
    <article>
      <p className="eyebrow mb-3">
        {KIND_LABEL[report.kind ?? "cartera"]}
        {report.focus ? ` · ${report.focus}` : ""} · {longDate(report.createdAt.slice(0, 10))} ·{" "}
        {report.model}
      </p>
      {report.question && (
        <p className="card mb-4 p-3 text-[13px] leading-snug" style={{ color: "var(--color-ink-2)" }}>
          Tu pregunta: «{report.question}»
        </p>
      )}

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
  );
}
