"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AjustesShell } from "@/components/ajustes/Shell";
import { Notice } from "@/components/ui/Notice";
import { ON_DEVICE } from "@/lib/backend";
import { useStore } from "@/lib/store";
import { useUpdate } from "@/lib/use-update";
import { relativeTime } from "@/lib/format";
import { installStatus, installUpdate, openInstallSettings } from "@/lib/self-update";
import type { ReleaseInfo } from "@/lib/update";
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
 * La app baja el APK y se lo instala (`self-update.ts`): la primera vez pide
 * el permiso de instalar apps, y desde Android 12 no vuelve a preguntar. Como
 * esta firmado siempre con la misma clave, se instala encima y los datos
 * quedan. El navegador queda de respaldo.
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
      intro="Instalá la versión nueva sin salir de la app."
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
        <Instalar release={u.release} />
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

type Fase =
  | { paso: "listo" }
  | { paso: "permiso" }
  | { paso: "bajando"; done: number; total: number }
  | { paso: "instalando" }
  | { paso: "error"; mensaje: string };

const mb = (bytes: number) => (bytes / 1024 / 1024).toLocaleString("es-AR", { maximumFractionDigits: 1 });

/** Bajar e instalar la version nueva desde la app, con el navegador de respaldo. */
function Instalar({ release }: { release: ReleaseInfo }) {
  const [fase, setFase] = useState<Fase>({ paso: "listo" });
  // Se fue a la pantalla del permiso: al volver, se sigue sin otro toque.
  const esperandoPermiso = useRef(false);

  const empezar = useCallback(async () => {
    const estado = await installStatus();
    if (!estado) {
      setFase({ paso: "error", mensaje: "Esta instalación no puede actualizarse sola." });
      return;
    }
    if (!estado.allowed) {
      setFase({ paso: "permiso" });
      return;
    }
    setFase({ paso: "bajando", done: 0, total: release.size ?? 0 });
    try {
      await installUpdate(
        release,
        (done, total) => setFase({ paso: "bajando", done, total }),
        (mensaje) => setFase({ paso: "error", mensaje }),
      );
      setFase((f) => (f.paso === "error" ? f : { paso: "instalando" }));
    } catch (err) {
      setFase({ paso: "error", mensaje: err instanceof Error ? err.message : "No se pudo bajar la actualización." });
    }
  }, [release]);

  useEffect(() => {
    const volver = () => {
      if (document.visibilityState !== "visible" || !esperandoPermiso.current) return;
      esperandoPermiso.current = false;
      void empezar();
    };
    document.addEventListener("visibilitychange", volver);
    window.addEventListener("focus", volver);
    return () => {
      document.removeEventListener("visibilitychange", volver);
      window.removeEventListener("focus", volver);
    };
  }, [empezar]);

  const ocupado = fase.paso === "bajando" || fase.paso === "instalando";
  return (
    <div className="mt-4">
      {fase.paso === "permiso" ? (
        <>
          <Notice tone="info">Para instalarse sola, Waltra necesita permiso para instalar apps. Se da una sola vez.</Notice>
          <button
            type="button"
            className="btn btn-primary mt-3 w-full"
            onClick={() => {
              esperandoPermiso.current = true;
              void openInstallSettings();
            }}
          >
            Dar permiso
          </button>
        </>
      ) : fase.paso === "bajando" ? (
        <div className="card p-3">
          <p className="text-[13px]">
            Bajando la <span className="num">{release.version}</span>…
            {fase.total > 0 && <span className="label num"> {mb(fase.done)} de {mb(fase.total)} MB</span>}
          </p>
          <div
            className="mt-2 h-1.5 w-full"
            style={{ background: "var(--color-surface-3)" }}
            role="progressbar"
            aria-label="Descarga de la actualización"
            aria-valuemin={0}
            aria-valuemax={fase.total || undefined}
            aria-valuenow={fase.done}
          >
            <div
              className="h-full"
              style={{ width: `${fase.total > 0 ? Math.min(100, (fase.done / fase.total) * 100) : 0}%`, background: "var(--color-ink)" }}
            />
          </div>
        </div>
      ) : fase.paso === "instalando" ? (
        <Notice tone="info">Instalando. Waltra se va a cerrar y te avisa cuando esté lista.</Notice>
      ) : (
        <>
          {fase.paso === "error" && <div className="mb-3"><Notice>{fase.mensaje}</Notice></div>}
          <button type="button" className="btn btn-primary w-full" onClick={() => void empezar()}>
            {fase.paso === "error" ? "Reintentar" : `Actualizar a la ${release.version}`}
          </button>
        </>
      )}
      {!ocupado && (
        <a href={release.url} target="_blank" rel="noopener noreferrer" className="label mt-2 block text-center underline">
          o bajala con el navegador
        </a>
      )}
    </div>
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
