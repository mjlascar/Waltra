"use client";

import { AjustesShell } from "@/components/ajustes/Shell";
import { ApiKeyField } from "@/components/ajustes/ApiKeyField";
import { Field } from "@/components/ui/Field";
import { SectionTitle } from "@/components/ui/Stat";
import { useStore } from "@/lib/store";
import { ON_DEVICE } from "@/lib/backend";
import { DEFAULT_MODEL, MODELS } from "@/lib/insights/models";

/** Que modelo analiza la cartera y con que clave se paga. */
export default function InsightsAjustes() {
  const { settings, updateSettings } = useStore();

  return (
    <AjustesShell
      title="Insights"
      intro="El análisis con búsqueda web sale de tu propia cuenta de Anthropic y se paga por uso."
    >
      <section className="mb-5">
        <div className="card p-3">
          <Field
            label="Modelo"
            hint={
              MODELS.find((m) => m.id === (settings.model ?? DEFAULT_MODEL))?.detail ??
              "Cada análisis consume créditos de tu cuenta de Anthropic."
            }
          >
            <select
              className="input"
              value={settings.model ?? DEFAULT_MODEL}
              onChange={(e) => void updateSettings({ model: e.target.value })}
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <p className="label mt-2 leading-snug">
            Cada análisis hace varias búsquedas web y dos llamadas al modelo. Bajar de
            modelo abarata, a costa de profundidad.
          </p>
        </div>
      </section>

      <section className="mb-5">
        <SectionTitle>{ON_DEVICE ? "Tu clave de Anthropic" : "Acceso a la API"}</SectionTitle>
        {ON_DEVICE ? (
          <ApiKeyField
            value={settings.apiKey}
            onChange={(key) => void updateSettings({ apiKey: key })}
          />
        ) : (
          <div className="card p-3">
            <Field
              label="Clave de acceso"
              hint="Solo hace falta si publicaste la app en internet con WALTRA_ACCESS_KEY. Se guarda en este teléfono."
            >
              <input
                className="input"
                type="password"
                autoComplete="off"
                value={settings.accessKey ?? ""}
                onChange={(e) => void updateSettings({ accessKey: e.target.value || undefined })}
                placeholder="vacío"
              />
            </Field>
          </div>
        )}
      </section>
    </AjustesShell>
  );
}
