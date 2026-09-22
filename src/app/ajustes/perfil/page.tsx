"use client";

import { Field, Segmented } from "@/components/ui/Field";
import { AjustesShell } from "@/components/ajustes/Shell";
import { useStore } from "@/lib/store";
import { BENCHMARK_CHOICES } from "@/lib/benchmark";

/**
 * Lo que el usuario declara sobre si mismo.
 *
 * No afecta ningun calculo: alimenta los insights, que sin esto solo pueden
 * dar consejos genericos, y fija la vara del grafico de rendimiento.
 */
export default function PerfilAjustes() {
  const { settings, updateSettings, refresh } = useStore();

  return (
    <AjustesShell
      title="Tu perfil como inversor"
      intro="No cambia ningún número de la app. Es lo que hace que el análisis hable de vos y no en general."
    >
        <div className="card space-y-3 p-3">
          <Field label="Tolerancia al riesgo">
            <Segmented
              value={settings.riskProfile}
              onChange={(v) => void updateSettings({ riskProfile: v })}
              options={[
                { value: "conservador", label: "Conservador" },
                { value: "moderado", label: "Moderado" },
                { value: "agresivo", label: "Agresivo" },
              ]}
            />
          </Field>
          <Field label="Horizonte" hint="En cuántos años pensás necesitar esta plata.">
            <input
              className="input num"
              type="number"
              min={1}
              max={50}
              value={settings.horizonYears}
              onChange={(e) => void updateSettings({ horizonYears: Number(e.target.value) || 1 })}
            />
          </Field>
          <Field
            label="Comparar contra"
            hint="La vara del gráfico de rendimiento: qué habrías conseguido sin elegir nada."
          >
            <select
              className="input"
              value={settings.benchmark ?? "SPY"}
              onChange={(e) => {
                void updateSettings({ benchmark: e.target.value });
                void refresh({ force: true });
              }}
            >
              {BENCHMARK_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Objetivo" hint="Con esto el análisis deja de ser genérico.">
            <textarea
              className="input"
              rows={3}
              maxLength={600}
              value={settings.goals}
              placeholder="Ej: juntar para un departamento en 5 años, sin sustos grandes."
              onChange={(e) => void updateSettings({ goals: e.target.value })}
            />
          </Field>
        </div>
    </AjustesShell>
  );
}
