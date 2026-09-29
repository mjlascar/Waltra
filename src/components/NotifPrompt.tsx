"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { NATIVE } from "@/lib/platform";
import { notificationPermission, requestNotificationPermission } from "@/lib/alerts/mirror";

/**
 * Pedir el permiso de notificaciones una vez, en el inicio.
 *
 * En Android 13 o mas nuevo una app necesita permiso para notificar, y
 * Waltra solo lo pedia al prender las alertas de precio o desde la pantalla
 * de actualizaciones. Quien nunca paso por ahi no recibia el aviso de una
 * version nueva: el vigia lo mandaba y Android lo descartaba sin decir nada.
 * Se ofrece una sola vez; si se rechaza, queda en Ajustes → Actualizaciones.
 */
export function NotifPrompt() {
  const { settings, updateSettings, ready } = useStore();
  const [falta, setFalta] = useState(false);

  useEffect(() => {
    if (!NATIVE || !ready || settings.notifAsked) return;
    let vivo = true;
    void notificationPermission().then((ok) => vivo && setFalta(!ok));
    return () => {
      vivo = false;
    };
  }, [ready, settings.notifAsked]);

  if (!falta || settings.notifAsked) return null;

  const cerrar = () => {
    setFalta(false);
    void updateSettings({ notifAsked: true });
  };

  return (
    <div
      className="mb-3 p-2.5"
      style={{ border: "1px solid var(--color-line-strong)", background: "var(--color-surface)" }}
    >
      <p className="text-[12px] leading-snug">
        Activá las notificaciones para enterarte cuando salga una versión nueva de Waltra y
        para recibir tus alertas de precio.
      </p>
      <div className="mt-2 flex gap-2">
        <button className="btn btn-ghost btn-sm flex-1" onClick={cerrar}>
          Ahora no
        </button>
        <button
          className="btn btn-primary btn-sm flex-[2]"
          onClick={() => void requestNotificationPermission().finally(cerrar)}
        >
          Activar
        </button>
      </div>
    </div>
  );
}
