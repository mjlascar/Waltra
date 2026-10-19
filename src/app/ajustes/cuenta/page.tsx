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
import { dateTime, relativeTime } from "@/lib/format";
import { NATIVE } from "@/lib/platform";

const STATUS = {
  unconfigured: "Google todavía no está configurado",
  loading: "Preparando el acceso a Google…", disconnected: "Solo en este dispositivo",
  syncing: "Sincronizando con tu Drive…", ok: "Sincronizado", pending: "Cambios pendientes",
  offline: "Sin conexión. Los cambios quedan guardados acá.",
  conflict: "Hay versiones distintas para revisar", error: "No se pudo sincronizar",
};

const OPTION: Record<OptionKind, { label: string; detail?: string }> = {
  device: { label: "Este dispositivo", detail: "Reemplaza Drive." },
  drive: { label: "Drive", detail: "Reemplaza este dispositivo." },
  "device-wins": { label: "Combinar, gana este dispositivo" },
  "drive-wins": { label: "Combinar, gana Drive" },
  join: { label: "Juntar los dos", detail: "Lo que cargaste en los dos queda repetido." },
  apply: { label: "Confirmar el borrado" },
};

function explain(conflict: CloudConflict): { title: string; body: string } {
  switch (conflict.kind) {
    case "first":
      return { title: "Hay datos acá y en tu Drive", body: "Elegí con cuáles seguir." };
    case "both":
      return conflict.clashes > 0 ? {
        title: "Los dos lados cambiaron lo mismo",
        body: `${conflict.clashes === 1 ? "Un cambio choca" : `${conflict.clashes} cambios chocan`}; lo demás se combina igual.`,
      } : {
        title: "No se pueden combinar",
        body: "Un lado borró una cuenta o un activo que el otro usa.",
      };
    case "shrink":
      return { title: "Se borraría casi toda la cartera", body: "Si borraste a propósito, confirmalo." };
    case "missing":
      return { title: "La copia de Drive ya no está", body: "Podés volver a crearla con estos datos." };
    case "copies":
      return { title: "Hay más de una copia en Drive", body: "Elegí cuál queda." };
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
    <AjustesShell title="Cuenta y sincronización" intro="Una copia privada de tu cartera en tu Google Drive." message={message}>
      <div className="card mb-4 space-y-3 p-3">
        <div className="eyebrow">Google Drive</div>
        {cloud.user ? <div className="min-w-0">
          <p className="text-[14px] font-medium break-words">{cloud.user.name ?? "Tu cuenta de Google"}</p>
          <p className="label break-all">{cloud.user.email}</p>
        </div> : cloud.linked && <p className="label break-words">
          Vinculada a {cloud.linked.email ?? "otra cuenta"}.
        </p>}
        <p role="status" aria-live="polite" className="text-[12px] leading-relaxed">{STATUS[cloud.status]}</p>
        {cloud.lastSync && <p className="label">Última sincronización: {relativeTime(cloud.lastSync)}</p>}
        {cloud.message && <div role="alert"><Notice>{cloud.message}</Notice></div>}
        {cloud.status === "unconfigured" ? (
          <Notice tone="info">Esta versión no tiene Google configurado.</Notice>
        ) : cloud.user ? (
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-sm" disabled={busy || Boolean(conflict)} onClick={() => void cloud.sync()}>Sincronizar ahora</button>
            <button className="btn btn-sm" disabled={busy} onClick={() => void cloud.login()}>Reconectar Google</button>
            <button className="btn btn-sm btn-ghost" disabled={cloud.status === "loading"} onClick={() => void cloud.logout()}>Desconectar</button>
          </div>
        ) : (
          <button className="btn btn-primary w-full" disabled={busy} onClick={() => void cloud.login()}>Conectar Google Drive</button>
        )}
        {/* Antes de conectar se dice que viaja, notas incluidas: es la decision
            de privacidad de la app (ver CLAUDE.md). Despues ya no hace falta. */}
        {!cloud.user && cloud.status !== "unconfigured" && <p className="label leading-relaxed">
          Sube todo lo que cargaste, notas incluidas, a una carpeta oculta de tu Drive
          que solo ve Waltra. Las claves de API no viajan.
        </p>}
      </div>

      {conflict && text && <section className="card mb-4 space-y-3 p-3" aria-label="Resolver versiones distintas">
        <h2 className="text-[14px] font-medium">{text.title}</h2>
        <Notice>{text.body}</Notice>
        <fieldset className="space-y-3" disabled={busy}>
          <legend className="label mb-2">Con qué seguir</legend>
          {conflict.options.map((option) => <label key={option.id} className="flex items-start gap-2 text-[12px]">
            <input type="radio" name="version" value={option.id} checked={choice === option.id} onChange={() => setChoice(option.id)} />
            <span className="min-w-0">
              <span className="block">
                {OPTION[option.kind].label} · {movimientos(option.transactions)}
                {option.at && ` · ${dateTime(option.at)}`}
              </span>
              {OPTION[option.kind].detail && <span className="label block leading-snug">{OPTION[option.kind].detail}</span>}
            </span>
          </label>)}
        </fieldset>
        <button className="btn btn-sm w-full" disabled={busy || !conflict.options.some((o) => o.id === choice)} onClick={() => {
          void cloud.sync({ local: conflict.local, tokens: conflict.versions.map(versionToken), choice });
          setChoice("");
        }}>Confirmar</button>
        <p className="label">Lo que se reemplace queda como copia de recuperación.</p>
      </section>}

      {copies.length > 0 && <div className="card mb-4 space-y-2 p-3">
        <h2 className="text-[14px] font-medium">Copias de recuperación</h2>
        <p className="label leading-relaxed">
          Las últimas {MAX_RECOVERY} versiones que se reemplazaron. Exportada, se importa desde Tus datos.
        </p>
        <ul className="divide-hairline">
          {copies.map(({ copy, transactions }) => <li key={copy.id} className="flex items-center justify-between gap-2 py-2">
            <span className="min-w-0 text-[12px]">
              {copy.origin === "drive" ? "De Drive" : "De este dispositivo"} · {dateTime(copy.at)}
              <span className="label block">{movimientos(transactions)}</span>
            </span>
            <button className="btn btn-sm shrink-0" onClick={() => void exportRecovery(copy)}>Exportar</button>
          </li>)}
        </ul>
      </div>}
      {cloud.linked && <div className="card mb-4 space-y-2 p-3">
        <h2 className="text-[14px] font-medium">Desvincular</h2>
        <p className="label leading-relaxed">Para usar otra cuenta. Tus datos quedan acá y en Drive.</p>
        {unlinking ? <div className="flex flex-wrap gap-2">
          <button className="btn btn-sm" disabled={busy} onClick={() => { setUnlinking(false); void cloud.unlink(); }}>Sí, desvincular</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setUnlinking(false)}>Cancelar</button>
        </div> : <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setUnlinking(true)}>Desvincular</button>}
      </div>}
      {!NATIVE && cloud.linked && <p className="label">En la web hay que reconectar al recargar la página.</p>}
    </AjustesShell>
  );
}
