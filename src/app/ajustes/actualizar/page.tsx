"use client";

import { useEffect, useState } from "react";
import { AjustesShell } from "@/components/ajustes/Shell";
import { Notice } from "@/components/ui/Notice";
import { ON_DEVICE } from "@/lib/backend";
import { useStore } from "@/lib/store";
import { useUpdate } from "@/lib/use-update";
import { relativeTime } from "@/lib/format";
import { notificationPermission, requestNotificationPermission } from "@/lib/alerts/mirror";

/**
 * Actualizar la app sin pasar por GitHub.
 *
 * El APK se baja con el navegador y Android pide confirmar la instalacion:
 * son dos toques y la app no necesita el permiso de instalar paquetes. Como
 * esta firmado siempre con la misma clave, se instala encima y los datos
 * quedan.
 */
export default function ActualizarAjustes() {
  const { settings, updateSettings } = useStore();
  const u = useUpdate();
  // Sin permiso, en Android 13 o mas nuevo el aviso no llega aunque el vigia
  // lo mande, y si nunca se prendieron las alertas nadie lo pidio.
  const [permiso, setPermiso] = useState<boolean | null>(null);
  useEffect(() => {
    if (!ON_DEVICE) return;
    void notificationPermission().then(setPermiso);
  }, []);
  const avisar = settings.updateNotify !== false;

  if (!ON_DEVICE) {
    return (
      <AjustesShell title="Actualizaciones">
        <Notice tone="info">
          La versión web se actualiza sola al recargar. Esto es para la app instalada
          como APK.
        </Notice>
      </AjustesShell>
    );
  }

  return (
    <AjustesShell
      title="Actualizaciones"
      intro="Cada cambio que se publica genera una versión nueva de la app. Desde acá la bajás sin entrar a GitHub."
    >
      <div className="card p-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="label">Instalada</span>
          <span className="num text-[14px]">{u.installed ? u.installed.version : "—"}</span>
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <span className="label">Publicada</span>
          <span className="num text-[14px]">
            {u.release ? u.release.version : u.checking ? "buscando…" : "—"}
          </span>
        </div>
        {u.release?.publishedAt && (
          <p className="label mt-1 text-right">{relativeTime(u.release.publishedAt)}</p>
        )}
      </div>

      {u.error && !u.checking && (
        <div className="mt-3">
          <Notice>No se pudo consultar la última versión: {u.error}.</Notice>
        </div>
      )}

      {u.available && u.release ? (
        <div className="mt-4">
          {/* Un enlace y no un fetch: la descarga la hace el navegador, que
              sabe guardar el APK y ofrecer abrirlo al terminar. */}
          <a
            href={u.release.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary block w-full text-center"
          >
            Descargar la versión {u.release.version}
          </a>
          <p className="label mt-2 leading-relaxed">
            Se baja con el navegador. Cuando termine, tocá la descarga y confirmá
            «Instalar»: se instala encima de esta y tus datos quedan. La primera vez,
            Android puede pedirte permitir instalar apps desde el navegador.
          </p>
        </div>
      ) : (
        !u.checking &&
        u.release &&
        !u.error && <p className="label mt-4">Tenés la última versión.</p>
      )}

      <button
        type="button"
        className="btn btn-ghost mt-4 w-full"
        disabled={u.checking}
        onClick={u.check}
      >
        {u.checking ? "Buscando…" : u.available ? "Buscar de nuevo" : "Buscar actualizaciones"}
      </button>
      {/* El vigia revisa solo cada unas seis horas: esto dice cuando fue la
          ultima vez que se miro desde aca, para saber si vale tocar el boton. */}
      {u.checkedAt && !u.checking && (
        <p className="label mt-1.5 text-center">
          Última búsqueda: {relativeTime(new Date(u.checkedAt).toISOString())}
        </p>
      )}

      <label className="card mt-4 flex items-start gap-2.5 p-3">
        <input
          type="checkbox"
          className="check mt-0.5"
          checked={avisar}
          onChange={(e) => {
            void updateSettings({ updateNotify: e.target.checked });
            if (e.target.checked && !permiso) void requestNotificationPermission().then(setPermiso);
          }}
        />
        <span className="text-[13px] leading-snug">
          Avisarme cuando salga una versión nueva
          <span className="label mt-1 block leading-snug">
            Una notificación por versión. Se revisa cada unas seis horas, fuera del
            horario de silencio de las alertas.
          </span>
        </span>
      </label>
      {avisar && permiso === false && (
        <button
          type="button"
          className="btn btn-ghost mt-2 w-full"
          onClick={() => void requestNotificationPermission().then(setPermiso)}
        >
          Permitir notificaciones
        </button>
      )}
    </AjustesShell>
  );
}
