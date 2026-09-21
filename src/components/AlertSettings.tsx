"use client";

import { useEffect, useState } from "react";
import { Field, Segmented } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { useStore } from "@/lib/store";
import { alertRules, thresholdFor, type AlertRules } from "@/lib/alerts/plan";
import {
  notificationPermission,
  requestNotificationPermission,
  sendTestNotification,
} from "@/lib/alerts/mirror";

/** Los umbrales se eligen de una lista: escribir "4,5%" no le sirve a nadie. */
const UMBRALES = ["0", "3", "5", "10", "20"] as const;
const UMBRALES_CARTERA = ["0", "2", "3", "5"] as const;

function etiquetaUmbral(v: string) {
  return v === "0" ? "nunca" : `${v}%`;
}

/**
 * Alertas de precio.
 *
 * Todo lo que se configura aca termina en el plan que lee el vigia. Lo que la
 * pantalla tiene que dejar claro, y por eso hay tanto texto: Android decide
 * cuando corre el vigia, no la app. Prometer "cada 30 minutos" seria mentir.
 */
export function AlertSettings() {
  const { settings, updateSettings, portfolio, assets } = useStore();
  const rules = alertRules(settings);
  const [permiso, setPermiso] = useState<boolean | null>(null);
  const [probando, setProbando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    void notificationPermission().then(setPermiso);
  }, [rules.enabled]);

  function set(patch: Partial<AlertRules>) {
    void updateSettings({ alerts: { ...rules, ...patch } });
  }

  async function encender() {
    // Si el permiso no sale, no se avisa aca: del cartel se encarga el bloque
    // de abajo, que ademas sigue estando si uno entra otro dia sin haberlo
    // concedido. Decirlo en los dos lados era decirlo dos veces.
    setPermiso(await requestNotificationPermission());
    set({ enabled: true });
  }

  // Solo los activos que el vigia puede cotizar: uno de precio manual no se
  // mueve solo, asi que ofrecer un umbral seria ofrecer algo que no pasa.
  const vigilables = portfolio.positions.filter((pos) => {
    const asset = assets.find((a) => a.id === pos.assetId);
    return asset && asset.source !== "manual" && !asset.archived && pos.quantity > 0;
  });

  if (!rules.enabled) {
    return (
      <div className="card p-3">
        <p className="label mb-3 leading-relaxed">
          Waltra puede mirar los precios con la pantalla apagada y avisarte cuando algo
          se mueve fuerte. Todo pasa en el teléfono: no hay servidor que sepa qué tenés.
        </p>
        <button className="btn btn-primary btn-sm w-full" onClick={() => void encender()}>
          Activar alertas
        </button>
      </div>
    );
  }

  return (
    <>
      {aviso && <Notice>{aviso}</Notice>}
      {permiso === false && (
        <Notice>
          Falta el permiso de notificaciones. Sin eso el vigía corre pero no te avisa
          nada. Se habilita en los ajustes de Android, en Waltra → Notificaciones.
        </Notice>
      )}

      <div className="card mb-3 p-3">
        <Field
          label="Avisarme si un activo se mueve"
          hint="Variación del día, para arriba o para abajo."
        >
          <Segmented
            value={String(rules.defaultPct)}
            onChange={(v) => set({ defaultPct: Number(v) })}
            options={UMBRALES.map((v) => ({ value: v, label: etiquetaUmbral(v) }))}
          />
        </Field>

        <div className="mt-4">
          <Field
            label="Avisarme si la cartera entera se mueve"
            hint="Sobre el total en dólares, contando el efectivo."
          >
            <Segmented
              value={String(rules.portfolioPct)}
              onChange={(v) => set({ portfolioPct: Number(v) })}
              options={UMBRALES_CARTERA.map((v) => ({ value: v, label: etiquetaUmbral(v) }))}
            />
          </Field>
        </div>
      </div>

      {vigilables.length > 0 && (
        <>
          <div className="eyebrow mb-2">Por activo</div>
          <ul className="card divide-hairline mb-3">
            {vigilables.map((pos) => {
              const propio = rules.perAsset[pos.assetId];
              const valor = thresholdFor(rules, pos.assetId);
              return (
                <li key={pos.assetId} className="flex items-center gap-2 p-2.5">
                  <span className="min-w-0 flex-1 truncate text-[13px]">{pos.symbol}</span>
                  <select
                    className="input shrink-0"
                    // El desplegable trae su propia flecha: con menos ancho,
                    // el "%" le queda debajo.
                    style={{ width: 124 }}
                    value={propio === undefined ? "" : String(propio)}
                    onChange={(e) => {
                      const next = { ...rules.perAsset };
                      if (e.target.value === "") delete next[pos.assetId];
                      else next[pos.assetId] = Number(e.target.value);
                      set({ perAsset: next });
                    }}
                  >
                    <option value="">usar {etiquetaUmbral(String(rules.defaultPct))}</option>
                    {UMBRALES.map((v) => (
                      <option key={v} value={v}>
                        {etiquetaUmbral(v)}
                      </option>
                    ))}
                  </select>
                  {propio !== undefined && valor === 0 && (
                    <span className="label shrink-0">mudo</span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="card mb-3 p-3">
        <Field label="Resumen diario" hint="Cuánto vale tu cartera y cuánto se movió en el día.">
          <select
            className="input"
            value={rules.digestHour === null ? "" : String(rules.digestHour)}
            onChange={(e) =>
              set({ digestHour: e.target.value === "" ? null : Number(e.target.value) })
            }
          >
            <option value="">sin resumen</option>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </Field>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="No molestar desde">
            <select
              className="input"
              value={String(rules.quietFrom)}
              onChange={(e) => set({ quietFrom: Number(e.target.value) })}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </Field>
          <Field label="Hasta">
            <select
              className="input"
              value={String(rules.quietTo)}
              onChange={(e) => set({ quietTo: Number(e.target.value) })}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="label mt-2 leading-snug">
          {rules.quietFrom === rules.quietTo
            ? "Con la misma hora en los dos, no hay franja de silencio."
            : "Lo que pase en esa franja te lo avisa cuando termina, no se pierde."}
        </p>
      </div>

      <div className="card p-3">
        <p className="label mb-3 leading-relaxed">
          Android decide cuándo despertar a Waltra: pide cada 30 minutos, pero puede
          demorar bastante más si el teléfono está quieto o con poca batería. En los
          Samsung conviene además sacar a Waltra de <strong>Apps en suspensión</strong>,
          en Ajustes → Batería, o las alertas se van a espaciar solas.
        </p>
        <button
          className="btn btn-sm w-full"
          disabled={probando}
          onClick={async () => {
            setProbando(true);
            setAviso(null);
            try {
              await sendTestNotification();
              setAviso("Notificación de prueba enviada. Debería llegar en un segundo.");
            } catch (err) {
              setAviso(err instanceof Error ? err.message : String(err));
            } finally {
              setProbando(false);
            }
          }}
        >
          {probando ? "Enviando…" : "Probar una notificación"}
        </button>
        <button
          className="btn btn-sm mt-2 w-full"
          onClick={() => {
            set({ enabled: false });
            setAviso(null);
          }}
        >
          Apagar las alertas
        </button>
      </div>
    </>
  );
}
