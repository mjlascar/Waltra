"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { AjustesShell } from "@/components/ajustes/Shell";
import { Notice } from "@/components/ui/Notice";
import { useCloud } from "@/lib/cloud/provider";
import { decodeData } from "@/lib/cloud/data";
import { versionToken } from "@/lib/cloud/drive";
import { saveBackupFile } from "@/lib/backup-file";
import { useStore } from "@/lib/store";
import { relativeTime } from "@/lib/format";
import { NATIVE } from "@/lib/platform";

const STATUS = {
  unconfigured: "Google todavía no está configurado",
  loading: "Preparando el acceso a Google…", disconnected: "Solo en este dispositivo",
  syncing: "Sincronizando con tu Drive…", ok: "Sincronizado", pending: "Cambios pendientes",
  offline: "Sin conexión. Los cambios quedan guardados acá.",
  conflict: "Hay versiones distintas para revisar", error: "No se pudo sincronizar",
};

export default function CuentaAjustes() {
  const cloud = useCloud();
  const { db, ready, dbError } = useStore();
  const [choice, setChoice] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const recovery = useLiveQuery(() => db?.cloudBackups.orderBy("id").last(), [db]);
  const busy = cloud.status === "loading" || cloud.status === "syncing" || !ready || Boolean(dbError);

  async function exportRecovery() {
    if (!recovery) return;
    try {
      const result = await saveBackupFile("waltra-antes-de-sincronizar.json", JSON.stringify({
        ...decodeData(recovery.payload), exportedAt: recovery.at,
      }, null, 2));
      setMessage(result.message);
    } catch (err) { setMessage(err instanceof Error ? err.message : "No se pudo exportar la copia."); }
  }

  return (
    <AjustesShell title="Cuenta y sincronización" intro="Tu cartera, guardada en tu cuenta de Google. Podés seguir usando Waltra sin conexión." message={message}>
      <div className="card mb-4 space-y-3 p-3">
        <div className="eyebrow">Google Drive</div>
        {cloud.user && <div className="min-w-0">
          <p className="text-[14px] font-medium break-words">{cloud.user.name ?? "Tu cuenta de Google"}</p>
          <p className="label break-all">{cloud.user.email}</p>
        </div>}
        <p role="status" aria-live="polite" className="text-[12px] leading-relaxed">{STATUS[cloud.status]}</p>
        {cloud.lastSync && <p className="label">Última sincronización: {relativeTime(cloud.lastSync)}</p>}
        {cloud.message && <div role="alert"><Notice>{cloud.message}</Notice></div>}
        {cloud.status === "unconfigured" ? (
          <Notice tone="info">Esta versión necesita el cliente de Google de Waltra. Una vez configurado, cada usuario guarda sus datos en su propio Drive.</Notice>
        ) : cloud.user ? (
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-sm" disabled={busy || Boolean(cloud.conflict)} onClick={() => void cloud.sync()}>Sincronizar ahora</button>
            <button className="btn btn-sm" disabled={busy} onClick={() => void cloud.login()}>Reconectar Google</button>
            <button className="btn btn-sm btn-ghost" disabled={cloud.status === "loading"} onClick={() => void cloud.logout()}>Desconectar</button>
          </div>
        ) : (
          <button className="btn btn-primary w-full" disabled={busy} onClick={() => void cloud.login()}>Conectar Google Drive</button>
        )}
        <p className="label leading-relaxed">
          Al conectar, autorizás a Waltra a sincronizar cuentas, activos, movimientos,
          perfil e informes. La copia es privada y está oculta en el espacio de Waltra
          dentro de tu Drive. La app solo pide acceso a sus propios archivos.
          Se conserva una única copia de hasta 5 MiB, reemplazada al sincronizar.
        </p>
      </div>

      {cloud.conflict && <section className="card mb-4 space-y-3 p-3" aria-label="Resolver versiones distintas">
        <h2 className="text-[14px] font-medium">Elegí qué versión conservar</h2>
        <Notice>Hay cambios en más de un equipo, o una copia anterior en Drive. Se pausó la sincronización para que puedas revisarlos. Elegir una versión reemplaza la otra. No se conserva un historial en Drive.</Notice>
        <fieldset className="space-y-2" disabled={busy}>
          <legend className="label mb-2">Versión que se usará en tus equipos</legend>
          <label className="flex items-start gap-2 text-[12px]">
            <input type="radio" name="version" value="local" checked={choice === "local"} onChange={() => setChoice("local")} />
            Este dispositivo · {decodeData(cloud.conflict.local).transactions.length} movimientos
          </label>
          {cloud.conflict.versions.map((version) => <label key={version.id} className="flex items-start gap-2 text-[12px]">
            <input type="radio" name="version" value={version.id} checked={choice === version.id} onChange={() => setChoice(version.id)} />
            Drive · {decodeData(version.payload).transactions.length} movimientos · {new Date(version.at).toLocaleString("es-AR")}
          </label>)}
        </fieldset>
        <button className="btn btn-sm w-full" disabled={busy || !choice || (choice !== "local" && !cloud.conflict.versions.some((v) => v.id === choice))} onClick={() => {
          const conflict = cloud.conflict;
          if (!conflict) return;
          void cloud.sync({ local: conflict.local, tokens: conflict.versions.map(versionToken), choice });
          setChoice("");
        }}>Confirmar y sincronizar esta versión</button>
        <p className="label leading-relaxed">Si elegís Drive, se guarda una copia local de recuperación antes de reemplazar los datos del dispositivo. Podés exportar tus datos actuales desde Ajustes → Tus datos antes de confirmar.</p>
      </section>}

      {recovery && <div className="card mb-4 space-y-2 p-3">
        <h2 className="text-[14px] font-medium">Copia anterior del dispositivo</h2>
        <p className="label">Guardada el {new Date(recovery.at).toLocaleString("es-AR")}, antes de descargar otra versión.</p>
        <button className="btn btn-sm w-full" onClick={() => void exportRecovery()}>Exportar copia de recuperación</button>
      </div>}
      <p className="label leading-relaxed">
        Las claves de Anthropic, Gemini y del servidor quedan en este dispositivo.
        Desconectar pausa la sincronización y conserva los datos locales y de Drive.
        Esta instalación queda vinculada a la primera cuenta que conectes para evitar mezclar carteras.
        {!NATIVE && " En el navegador, reconectá Google después de cerrar o recargar la app, o cuando venza el permiso."}
      </p>
    </AjustesShell>
  );
}
