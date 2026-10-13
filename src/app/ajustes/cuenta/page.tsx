"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { AjustesShell } from "@/components/ajustes/Shell";
import { Notice } from "@/components/ui/Notice";
import { useCloud } from "@/lib/cloud/provider";
import { decodeData } from "@/lib/cloud/data";
import { versionToken } from "@/lib/cloud/drive";
import { MAX_RECOVERY, type CloudConflict, type OptionKind } from "@/lib/cloud/sync";
import { saveBackupFile } from "@/lib/backup-file";
import type { CloudBackup } from "@/lib/db";
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

const OPTION: Record<OptionKind, { label: string; detail: string }> = {
  device: { label: "Los datos de este dispositivo", detail: "Reemplaza la copia de Drive." },
  drive: { label: "La copia de Drive", detail: "Reemplaza los datos de este dispositivo." },
  "device-wins": { label: "Combinar, y donde chocan, este dispositivo", detail: "Se suma todo lo que no choca." },
  "drive-wins": { label: "Combinar, y donde chocan, Drive", detail: "Se suma todo lo que no choca." },
  join: {
    label: "Juntar los dos",
    detail: "Suma los movimientos de los dos lados. Si cargaste lo mismo en los dos, va a quedar repetido.",
  },
  apply: { label: "Confirmar el borrado", detail: "Queda así en este dispositivo y en Drive." },
};

function explain(conflict: CloudConflict): { title: string; body: string } {
  switch (conflict.kind) {
    case "first":
      return {
        title: "Hay datos acá y en tu Drive",
        body: "Es la primera vez que este dispositivo se conecta a esta cuenta y los dos lados tienen datos. Elegí con cuáles seguir.",
      };
    case "both":
      return conflict.clashes > 0 ? {
        title: "Los dos lados cambiaron lo mismo",
        body: `${conflict.clashes === 1 ? "Un cambio choca" : `${conflict.clashes} cambios chocan`}: se editó lo mismo acá y en otro dispositivo, o se cargó un ajuste o un split de un activo que el otro también tocó. Todo lo demás se combina igual.`,
      } : {
        title: "No se pueden combinar los dos lados",
        body: "Combinarlos dejaría movimientos apuntando a una cuenta o un activo que se borró del otro lado. Elegí uno de los dos.",
      };
    case "shrink":
      return {
        title: "Se borraría casi toda la cartera",
        body: "Sincronizar dejaría muchos menos movimientos de los que hay de un lado. Si borraste a propósito, confirmalo; si no, quedate con los movimientos.",
      };
    case "missing":
      return {
        title: "La copia de Drive ya no está",
        body: "Se borró la copia de Waltra de tu Drive, o se le quitó el acceso a la app. Podés volver a crearla con los datos de este dispositivo.",
      };
    case "copies":
      return {
        title: "Hay más de una copia en Drive",
        body: "Dos dispositivos se conectaron por primera vez al mismo tiempo. Elegí cuál queda; las demás se borran de Drive.",
      };
  }
}

const movimientos = (n: number) => `${n} ${n === 1 ? "movimiento" : "movimientos"}`;

export default function CuentaAjustes() {
  const cloud = useCloud();
  const { db, ready, dbError } = useStore();
  const [choice, setChoice] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const recoveries = useLiveQuery(() => db ? db.cloudBackups.orderBy("id").reverse().toArray() : [], [db]);
  const copies = useMemo(() => (recoveries ?? []).map((copy) => ({
    copy, transactions: decodeData(copy.payload).transactions.length,
  })), [recoveries]);
  const busy = cloud.status === "loading" || cloud.status === "syncing" || !ready || Boolean(dbError);
  const conflict = cloud.conflict;
  const text = conflict ? explain(conflict) : null;

  async function exportRecovery(copy: CloudBackup) {
    try {
      const result = await saveBackupFile(`waltra-recuperacion-${copy.at.slice(0, 10)}.json`, JSON.stringify({
        ...decodeData(copy.payload), exportedAt: copy.at,
      }, null, 2));
      setMessage(result.message);
    } catch (err) { setMessage(err instanceof Error ? err.message : "No se pudo exportar la copia."); }
  }

  return (
    <AjustesShell title="Cuenta y sincronización" intro="Tu cartera, guardada en tu cuenta de Google. Podés seguir usando Waltra sin conexión." message={message}>
      <div className="card mb-4 space-y-3 p-3">
        <div className="eyebrow">Google Drive</div>
        {cloud.user ? <div className="min-w-0">
          <p className="text-[14px] font-medium break-words">{cloud.user.name ?? "Tu cuenta de Google"}</p>
          <p className="label break-all">{cloud.user.email}</p>
        </div> : cloud.linked && <p className="label leading-relaxed break-words">
          Vinculada a {cloud.linked.email ?? "la cuenta con que la conectaste"}. Conectá esa cuenta para seguir sincronizando.
        </p>}
        <p role="status" aria-live="polite" className="text-[12px] leading-relaxed">{STATUS[cloud.status]}</p>
        {cloud.lastSync && <p className="label">Última sincronización: {relativeTime(cloud.lastSync)}</p>}
        {cloud.message && <div role="alert"><Notice>{cloud.message}</Notice></div>}
        {cloud.status === "unconfigured" ? (
          <Notice tone="info">Esta versión necesita el cliente de Google de Waltra. Una vez configurado, cada usuario guarda sus datos en su propio Drive.</Notice>
        ) : cloud.user ? (
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-sm" disabled={busy || Boolean(conflict)} onClick={() => void cloud.sync()}>Sincronizar ahora</button>
            <button className="btn btn-sm" disabled={busy} onClick={() => void cloud.login()}>Reconectar Google</button>
            <button className="btn btn-sm btn-ghost" disabled={cloud.status === "loading"} onClick={() => void cloud.logout()}>Desconectar</button>
          </div>
        ) : (
          <button className="btn btn-primary w-full" disabled={busy} onClick={() => void cloud.login()}>Conectar Google Drive</button>
        )}
        <p className="label leading-relaxed">
          Al conectar, autorizás a Waltra a sincronizar cuentas, activos, movimientos
          (con sus notas y la frase con que los cargaste), perfil, preferencias e
          informes. La copia es privada y está oculta en el espacio de Waltra dentro
          de tu Drive; la app solo pide acceso a sus propios archivos y no la cifra
          aparte. Se conserva una única copia de hasta 5 MiB.
        </p>
      </div>

      {conflict && text && <section className="card mb-4 space-y-3 p-3" aria-label="Resolver versiones distintas">
        <h2 className="text-[14px] font-medium">{text.title}</h2>
        <Notice>{text.body} La sincronización queda en pausa hasta que elijas.</Notice>
        <fieldset className="space-y-3" disabled={busy}>
          <legend className="label mb-2">Con qué seguir, en este dispositivo y en Drive</legend>
          {conflict.options.map((option) => <label key={option.id} className="flex items-start gap-2 text-[12px]">
            <input type="radio" name="version" value={option.id} checked={choice === option.id} onChange={() => setChoice(option.id)} />
            <span className="min-w-0">
              <span className="block">
                {OPTION[option.kind].label} · {movimientos(option.transactions)}
                {option.at && ` · ${new Date(option.at).toLocaleString("es-AR")}`}
              </span>
              <span className="label block leading-snug">{OPTION[option.kind].detail}</span>
            </span>
          </label>)}
        </fieldset>
        <button className="btn btn-sm w-full" disabled={busy || !conflict.options.some((o) => o.id === choice)} onClick={() => {
          void cloud.sync({ local: conflict.local, tokens: conflict.versions.map(versionToken), choice });
          setChoice("");
        }}>Confirmar</button>
        <p className="label leading-relaxed">
          Lo que se reemplace queda guardado en este dispositivo como copia de
          recuperación. Igual podés exportar tus datos desde Ajustes → Tus datos antes de confirmar.
        </p>
      </section>}

      {copies.length > 0 && <div className="card mb-4 space-y-2 p-3">
        <h2 className="text-[14px] font-medium">Copias de recuperación</h2>
        <p className="label leading-relaxed">
          Lo que la sincronización reemplazó. Se guardan las últimas {MAX_RECOVERY}, solo en este
          dispositivo. Exportada, una copia se importa desde Ajustes → Tus datos, y suma sin borrar.
        </p>
        <ul className="divide-hairline">
          {copies.map(({ copy, transactions }) => <li key={copy.id} className="flex items-center justify-between gap-2 py-2">
            <span className="min-w-0 text-[12px]">
              {copy.origin === "drive" ? "De Drive" : "De este dispositivo"} · {new Date(copy.at).toLocaleString("es-AR")}
              <span className="label block">{movimientos(transactions)}</span>
            </span>
            <button className="btn btn-sm shrink-0" onClick={() => void exportRecovery(copy)}>Exportar</button>
          </li>)}
        </ul>
      </div>}
      {cloud.linked && <div className="card mb-4 space-y-2 p-3">
        <h2 className="text-[14px] font-medium">Desvincular esta instalación</h2>
        <p className="label leading-relaxed">
          Esta instalación sincroniza solo con {cloud.linked.email ?? "la cuenta con que la conectaste"}, para
          no mezclar carteras. Desvincularla desconecta Google y la deja como si nunca se hubiera
          conectado: tus datos quedan acá y en ese Drive. Si la próxima cuenta que conectes ya tiene
          datos de Waltra, vas a elegir con cuáles seguir.
        </p>
        {unlinking ? <div className="flex flex-wrap gap-2">
          <button className="btn btn-sm" disabled={busy} onClick={() => { setUnlinking(false); void cloud.unlink(); }}>Sí, desvincular</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setUnlinking(false)}>Cancelar</button>
        </div> : <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setUnlinking(true)}>Desvincular</button>}
      </div>}
      <p className="label leading-relaxed">
        Las claves de Anthropic, Gemini y del servidor quedan en este dispositivo.
        Desconectar pausa la sincronización y conserva los datos locales y de Drive.
        {NATIVE
          ? " Mientras la app está abierta, la sesión de Google se renueva sola."
          : " En el navegador, reconectá Google después de cerrar o recargar la app, o cuando venza el permiso: los cambios de mientras tanto se combinan al volver."}
      </p>
    </AjustesShell>
  );
}
