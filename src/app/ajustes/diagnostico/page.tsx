"use client";

import { useState } from "react";
import { AjustesShell } from "@/components/ajustes/Shell";
import { InstallPrompt } from "@/components/InstallPrompt";
import { SectionTitle } from "@/components/ui/Stat";
import { useStore } from "@/lib/store";
import { describeBackendError, diagnostics, ON_DEVICE } from "@/lib/backend";
import { money, relativeTime } from "@/lib/format";

interface Health {
  mock: boolean;
  aiConfigured: boolean;
  model: string;
  providers: { name: string; ok: boolean; ms: number; error?: string }[];
}

/**
 * Si algo no cotiza, aca se ve cual de las cuatro fuentes fallo.
 *
 * Existe porque los proveedores son APIs publicas gratuitas que pueden caerse
 * o bloquear por region, y "no aparece el precio" sin mas deja adivinando.
 */
export default function DiagnosticoAjustes() {
  const { settings, portfolio, backend } = useStore();
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function runHealth() {
    setChecking(true);
    setMessage(null);
    try {
      setHealth(await diagnostics(false, backend()));
    } catch (err) {
      setMessage(describeBackendError(err));
    } finally {
      setChecking(false);
    }
  }

  return (
    <AjustesShell title="Diagnóstico" message={message}>
      <section className="mb-5">
        <div className="card p-3">
          <p className="label mb-3 leading-relaxed">
            Los precios vienen de APIs públicas gratuitas. Si algo no cotiza, acá se ve
            cuál de las fuentes está caída.
          </p>
          <button className="btn btn-sm w-full" onClick={runHealth} disabled={checking}>
            {checking ? "Probando…" : "Probar las fuentes de datos"}
          </button>

          {health && (
            <div className="mt-3">
              <div className="divide-hairline">
                {health.providers.map((provider) => (
                  <div key={provider.name} className="flex items-center gap-2 py-2">
                    <span
                      className="swatch"
                      style={{ background: provider.ok ? "var(--color-pos)" : "var(--color-neg)" }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[12px]">{provider.name}</span>
                    <span className="num shrink-0 text-[11px]" style={{ color: "var(--color-ink-3)" }}>
                      {provider.ok ? `${provider.ms} ms` : "falla"}
                    </span>
                  </div>
                ))}
              </div>
              <p className="label mt-2 leading-snug">
                Insights: {health.aiConfigured ? `activos (${health.model})` : "sin clave configurada"}
                {health.mock && " · precios simulados"}
              </p>
              {health.providers.filter((x) => !x.ok).map((x) => (
                <p key={x.name} className="label mt-1 leading-snug">
                  {x.name}: {x.error}
                </p>
              ))}
            </div>
          )}

          <p className="label mt-3">
            Último refresco:{" "}
            {settings.lastQuoteSync ? relativeTime(settings.lastQuoteSync) : "nunca"}
            {" · "}dólar MEP{" "}
            {portfolio.fxLatest > 0 ? money(portfolio.fxLatest, "ARS", { decimals: 0 }) : "sin dato"}
          </p>
        </div>
      </section>

      {!ON_DEVICE && (
        <section className="mb-5">
          <SectionTitle>En tu teléfono</SectionTitle>
          <div className="card p-3">
            <InstallPrompt />
          </div>
        </section>
      )}
    </AjustesShell>
  );
}
