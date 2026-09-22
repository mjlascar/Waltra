"use client";

import { AjustesShell } from "@/components/ajustes/Shell";
import { ApiKeyField } from "@/components/ajustes/ApiKeyField";
import { Field, Segmented } from "@/components/ui/Field";
import { SectionTitle } from "@/components/ui/Stat";
import { useStore } from "@/lib/store";
import { ON_DEVICE } from "@/lib/backend";
import { PROVIDERS, providerInfo, resolveModel, resolveProvider } from "@/lib/insights/providers";

/**
 * Que modelo analiza la cartera y con que clave se paga.
 *
 * Las claves de los dos proveedores se guardan por separado: cambiar de
 * proveedor para probar no borra la del otro.
 */
export default function InsightsAjustes() {
  const { settings, updateSettings } = useStore();

  const provider = resolveProvider(settings.provider);
  const info = providerInfo(provider);
  const model = resolveModel(provider, settings.model);
  const detalle = info.models.find((m) => m.id === model)?.detail;

  return (
    <AjustesShell
      title="Insights"
      intro="El análisis con búsqueda web sale de tu propia cuenta y se paga por uso, salvo el nivel gratuito de Gemini."
    >
      <section className="mb-5">
        <SectionTitle>Proveedor</SectionTitle>
        <div className="card p-3">
          <Segmented
            value={provider}
            onChange={(v) =>
              // Al cambiar de proveedor se limpia el modelo: el de uno no
              // existe en el otro, y `resolveModel` caeria en el de la casa
              // igual, pero dejarlo guardado confunde la pantalla.
              void updateSettings({ provider: v, model: undefined })
            }
            options={PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
          />
          <p className="label mt-2 leading-relaxed">{info.nota}</p>
        </div>
      </section>

      <section className="mb-5">
        <SectionTitle>Modelo</SectionTitle>
        <div className="card p-3">
          <Field label="Modelo" hint={detalle}>
            <select
              className="input"
              value={model}
              onChange={(e) => void updateSettings({ model: e.target.value })}
            >
              {info.models.map((m) => (
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
        <SectionTitle>{ON_DEVICE ? `Tu clave de ${info.label}` : "Acceso a la API"}</SectionTitle>
        {ON_DEVICE ? (
          <ApiKeyField
            // La clave se reinicia al cambiar de proveedor para que el campo
            // no muestre el estado del otro.
            key={provider}
            label={info.label}
            keyUrl={info.keyUrl}
            placeholder={info.keyPlaceholder}
            value={provider === "gemini" ? settings.geminiKey : settings.apiKey}
            onChange={(clave) =>
              void updateSettings(provider === "gemini" ? { geminiKey: clave } : { apiKey: clave })
            }
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
