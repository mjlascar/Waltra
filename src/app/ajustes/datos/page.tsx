"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AjustesShell } from "@/components/ajustes/Shell";
import { BinanceImport } from "@/components/BinanceImport";
import { BulkImport } from "@/components/BulkImport";
import { IconTrash } from "@/components/icons";
import { useStore } from "@/lib/store";
import { exportBackup, importBackup, parseBackup, wipeAll } from "@/lib/db";
import { saveBackupFile } from "@/lib/backup-file";
import { clearDemoData, hasDemoData, loadDemoData } from "@/lib/demo";

/** Backup, importacion y el boton de borrar todo. */
export default function DatosAjustes() {
  const { transactions, db, refresh } = useStore();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);
  const [binance, setBinance] = useState(false);
  const [wipeText, setWipeText] = useState("");
  const [wiping, setWiping] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const demo = hasDemoData(transactions.map((t) => t.id));

  async function doExport() {
    if (!db) return;
    try {
      const backup = await exportBackup(db);
      const { message: resultado } = await saveBackupFile(
        `waltra-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(backup, null, 2),
      );
      setMessage(resultado);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function doImport(file: File) {
    if (!db) return;
    try {
      const summary = await importBackup(db, parseBackup(await file.text()), "merge");
      setMessage(
        `Importado: ${summary.transactions} movimientos, ${summary.assets} activos, ${summary.accounts} cuentas.`,
      );
      void refresh({ force: true });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <AjustesShell title="Tus datos" message={message}>
        <div className="card p-3">
          <p className="label mb-3 leading-relaxed">
            Todo vive en este teléfono. Si borrás los datos del navegador o cambiás de
            equipo, se pierde. El backup es un archivo tuyo, no sube a ningún lado.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-sm" onClick={doExport}>
              Exportar
            </button>
            <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
              Importar
            </button>
          </div>
          <button className="btn btn-sm mt-2 w-full" onClick={() => setBulk(true)}>
            Pegar movimientos desde tus notas
          </button>
          <button className="btn btn-sm mt-2 w-full" onClick={() => setBinance(true)}>
            Importar el historial de Binance
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void doImport(file);
              e.target.value = "";
            }}
          />
          <p className="label mt-2">
            Importar combina con lo que ya tenés: los movimientos con el mismo id se
            reemplazan, el resto se suma.
          </p>

          <div className="hairline mt-3 pt-3">
            {demo ? (
              <button
                className="btn btn-sm w-full"
                onClick={async () => {
                  if (!db) return;
                  await clearDemoData(db);
                  setMessage("Datos de ejemplo borrados.");
                }}
              >
                Borrar los datos de ejemplo
              </button>
            ) : (
              <button
                className="btn btn-sm w-full"
                onClick={async () => {
                  if (!db) return;
                  await loadDemoData(db);
                  await refresh({ force: true });
                  setMessage("Datos de ejemplo cargados.");
                }}
              >
                Cargar datos de ejemplo
              </button>
            )}
          </div>

          <div className="hairline mt-3 pt-3">
            <p className="eyebrow mb-2">Borrar todo</p>
            <p className="label mb-2 leading-snug">
              Escribí <strong style={{ color: "var(--color-ink)" }}>BORRAR</strong> para
              habilitar. Se va todo: movimientos, activos, cuentas e informes.
            </p>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                value={wipeText}
                onChange={(e) => setWipeText(e.target.value)}
                placeholder="BORRAR"
              />
              <button
                className="btn"
                style={{ borderColor: "var(--color-neg)", color: "var(--color-neg)" }}
                disabled={wipeText !== "BORRAR" || wiping}
                onClick={async () => {
                  if (!db || wipeText !== "BORRAR") return;
                  setWiping(true);
                  await wipeAll(db);
                  setWipeText("");
                  setWiping(false);
                  router.replace("/");
                }}
              >
                <IconTrash size={16} />
              </button>
            </div>
          </div>
        </div>

      <BulkImport open={bulk} onClose={() => setBulk(false)} />
      <BinanceImport open={binance} onClose={() => setBinance(false)} />
    </AjustesShell>
  );
}
