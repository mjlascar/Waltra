"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { importBackup } from "@/lib/db";
import { inspectStorage, type StorageReport } from "@/lib/storage-health";
import { listBackups, readBackup, type AutoBackup } from "@/lib/auto-backup";
import { shortDate } from "@/lib/format";
import { NATIVE } from "@/lib/platform";

const TABLAS: Record<string, string> = {
  transactions: "Movimientos",
  assets: "Activos",
  accounts: "Cuentas",
  priceSeries: "Historias de precio",
  quotes: "Cotizaciones",
  fx: "Días de dólar",
  insights: "Informes",
  settings: "Ajustes",
};

function megas(bytes: number | null): string {
  if (bytes === null) return "—";
  return `${(bytes / 1024 / 1024).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB`;
}

/**
 * Lo que hay de verdad en la base, tabla por tabla. Es lo primero que hay que
 * mirar cuando la app aparece vacia: si los movimientos estan y no se leen, o
 * si no estan.
 */
export function StorageStatus() {
  const { db } = useStore();
  const [report, setReport] = useState<StorageReport | null>(null);
  useEffect(() => {
    void inspectStorage(db).then(setReport);
  }, [db]);

  if (!report) return <p className="label">Revisando…</p>;
  return (
    <div className="space-y-1.5 text-[12px]">
      {report.openError ? (
        <p style={{ color: "var(--color-warn)" }} className="leading-snug">
          La base no abre: {report.openError}
        </p>
      ) : (
        Object.entries(report.tables).map(([tabla, n]) => (
          <div key={tabla} className="flex items-baseline justify-between gap-3">
            <span className="label">{TABLAS[tabla] ?? tabla}</span>
            <span className="num">{n}</span>
          </div>
        ))
      )}
      <div className="hairline mt-2 flex items-baseline justify-between gap-3 pt-2">
        <span className="label">Ocupa</span>
        <span className="num">{megas(report.usageBytes)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="label">Protegida contra limpiezas</span>
        <span className="num">
          {report.persisted === null ? "—" : report.persisted ? "sí" : "no"}
        </span>
      </div>
      {report.databases && (
        <div className="flex items-baseline justify-between gap-3">
          <span className="label">Bases</span>
          <span className="num text-right">
            {report.databases.map((d) => `${d.name} v${d.version ?? "?"}`).join(", ") || "ninguna"}
          </span>
        </div>
      )}
      <div className="flex items-baseline justify-between gap-3">
        <span className="label">Origen</span>
        <span className="num">{report.origin}</span>
      </div>
    </div>
  );
}

/**
 * Las copias que hay en el telefono para recuperar: las automaticas de cada
 * dia y los backups manuales que quedaron en la cache. Recuperar suma, no
 * borra: lo que se haya cargado despues queda.
 */
export function BackupList({ onRestored }: { onRestored?: (msg: string) => void }) {
  const { db, refresh } = useStore();
  const [copias, setCopias] = useState<AutoBackup[] | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  useEffect(() => {
    void listBackups().then(setCopias);
  }, []);

  if (!NATIVE) return null;
  if (copias === null) return <p className="label">Buscando copias…</p>;
  if (copias.length === 0) {
    return (
      <p className="label leading-snug">
        Todavía no hay copias en el teléfono. Se hace una por día mientras usás la app.
      </p>
    );
  }

  async function recuperar(c: AutoBackup) {
    if (!db || trabajando) return;
    setTrabajando(c.name + c.where);
    try {
      const file = await readBackup(c);
      const r = await importBackup(db, file, "merge");
      void refresh({ force: true });
      onRestored?.(`Recuperado: ${r.transactions} movimientos y ${r.assets} activos.`);
    } catch (err) {
      onRestored?.(`No se pudo recuperar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTrabajando(null);
    }
  }

  return (
    <ul className="divide-hairline">
      {copias.map((c) => (
        <li key={c.where + c.name} className="flex items-center gap-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-[13px]">{shortDate(c.day, true)}</div>
            <div className="label">
              {c.transactions === null ? "no se pudo leer" : `${c.transactions} movimientos`} ·{" "}
              {c.where === "copias" ? "copia automática" : "backup exportado"}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!c.transactions || trabajando !== null}
            onClick={() => void recuperar(c)}
          >
            {trabajando === c.name + c.where ? "Recuperando…" : "Recuperar"}
          </button>
        </li>
      ))}
    </ul>
  );
}
