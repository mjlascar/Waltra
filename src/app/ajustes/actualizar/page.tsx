"use client";

import { useEffect, useState } from "react";
import { AjustesShell } from "@/components/ajustes/Shell";
import { Notice } from "@/components/ui/Notice";
import { ON_DEVICE } from "@/lib/backend";
import { useStore } from "@/lib/store";
import { useUpdate } from "@/lib/use-update";
import { relativeTime } from "@/lib/format";
import {
  notificationPermission,
  readWatcherState,
  requestNotificationPermission,
  runWatcherNow,
  type WatcherState,
} from "@/lib/alerts/mirror";

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

  /**
   * Lo que el vigia dejo anotado. Un aviso que no llega no deja rastro en
   * ningun lado: aca se ve si Android lo esta dejando correr, si GitHub le
   * contesta y que version vio.
   */
  const [vigia, setVigia] = useState<WatcherState | null | undefined>(undefined);
  const [probando, setProbando] = useState(false);
  useEffect(() => {
    if (!ON_DEVICE) return;
    void readWatcherState().then(setVigia);
  }, []);
  async function probarVigia() {
    setProbando(true);
    try {
      await runWatcherNow();
    } catch {
      // Si no se pudo despertar, el estado de abajo lo dice igual.
    }
    setVigia(await readWatcherState());
    setProbando(false);
  }

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
            Una notificación por versión. Se revisa cada unas dos horas, fuera del
            horario de silencio de las alertas, cuando Android deja correr a la app.
          </span>
        </span>
      </label>
      {avisar && (
        <div className="card mt-3 p-3">
          <div className="eyebrow mb-2">En segundo plano</div>
          <EstadoVigia vigia={vigia} instalada={u.installed?.build ?? null} />
          <button
            type="button"
            className="btn btn-ghost btn-sm mt-3 w-full"
            disabled={probando}
            onClick={() => void probarVigia()}
          >
            {probando ? "Revisando…" : "Revisar ahora en segundo plano"}
          </button>
          <p className="label mt-2 leading-snug">
            Hace lo mismo que hace solo cada unas horas: pregunta a GitHub y, si hay una
            versión nueva que no te avisó, manda la notificación.
          </p>
        </div>
      )}
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

function hace(ms: number | undefined): string {
  return ms ? relativeTime(new Date(ms).toISOString()) : "nunca";
}

/** Lo que el vigia hizo, en tres renglones. */
function EstadoVigia({
  vigia,
  instalada,
}: {
  vigia: WatcherState | null | undefined;
  instalada: number | null;
}) {
  if (vigia === undefined) return <p className="label">Leyendo…</p>;
  const upd = vigia?.upd;
  const filas: [string, string][] = [
    ["Corrió por última vez", hace(vigia?.ran)],
    [
      "Le preguntó a GitHub",
      upd?.at ? `${hace(upd.at)} · vio la compilación ${upd.seen ?? "—"}` : "todavía no",
    ],
  ];
  if (upd?.err && (!upd.at || (upd.errAt ?? 0) > upd.at)) {
    filas.push(["Último intento", `${hace(upd.errAt)} · falló: ${upd.err}`]);
  }
  if (upd?.notified) filas.push(["Ya avisó", `la compilación ${upd.notified}`]);
  if (instalada) filas.push(["Tenés", `la compilación ${instalada}`]);
  return (
    <dl className="space-y-1.5">
      {filas.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3">
          <dt className="label">{k}</dt>
          <dd className="num text-right text-[12px]">{v}</dd>
        </div>
      ))}
      {!vigia?.ran && (
        <p className="label pt-1 leading-snug" style={{ color: "var(--color-warn)" }}>
          No corrió desde que instalaste esta versión. Si en unas horas sigue así,
          Android lo está frenando: en los ajustes del teléfono, Batería → Waltra, sacala
          de las apps en suspensión y dejala sin restricciones.
        </p>
      )}
    </dl>
  );
}
