"use client";

import { Sheet } from "@/components/ui/Sheet";
import { useStore } from "@/lib/store";
import { ON_DEVICE } from "@/lib/backend";
import { DIA_OPCIONES, KIND_DETAIL, KIND_LABEL, schedules } from "@/lib/insights/schedule";

/**
 * Los informes que se recuerdan solos. Antes ocupaban media pantalla de
 * Insights; ahora viven detras de un boton, porque se configuran una vez y
 * despues no se tocan.
 */
export function ScheduleSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, updateSettings } = useStore();
  const agenda = schedules(settings);
  if (!open) return null;
  return (
    <Sheet open onClose={onClose} title="Informe semanal">
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
    </Sheet>
  );
}
