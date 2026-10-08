"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { loadDemoData } from "@/lib/demo";
import { AddTransaction } from "@/components/AddTransaction";
import { BulkImport } from "@/components/BulkImport";
import { BackupList } from "@/components/DataRescue";
import { listBackups } from "@/lib/auto-backup";
import { NATIVE } from "@/lib/platform";
import Link from "next/link";

/**
 * Primera pantalla. No pide configurar nada: o cargas tu primer movimiento, o
 * mirás cómo se ve con datos de ejemplo. Un formulario de alta de cuentas
 * antes de ver nada es la forma mas rapida de que alguien abandone.
 */
export function EmptyStart() {
  const { db, refresh, dbError } = useStore();
  const [rescate, setRescate] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [loading, setLoading] = useState(false);

  async function demo() {
    if (!db || loading) return;
    setLoading(true);
    await loadDemoData(db);
    await refresh({ force: true });
    setLoading(false);
  }

  // La base no abrio: no es una app vacia, y ofrecer «cargar el primer
  // movimiento» a quien tiene semanas de datos es lo peor que se puede hacer.
  if (dbError) {
    return (
      <div className="pt-10 pb-6">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight">
          No pude abrir tus datos
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
          No borres nada ni desinstales la app: lo que no se puede abrir puede seguir en el
          teléfono. Cerrá la app del todo y volvé a abrirla. Si sigue igual, recuperá una
          copia de abajo.
        </p>
        <p className="card num mt-4 p-3 text-[11px] leading-snug" style={{ color: "var(--color-warn)" }}>
          {dbError}
        </p>
        <div className="card mt-4 p-3">
          <div className="eyebrow mb-2">Copias en el teléfono</div>
          <BackupList onRestored={setRescate} />
          {rescate && <p className="label mt-2">{rescate}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="pt-10 pb-6">
      <div className="mb-8">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">Waltra</h1>
        <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
          Cocos y Binance en un solo lugar, con las cuentas claras: cuánto pusiste,
          cuánto vale hoy y cuánto de eso es ganancia de verdad.
        </p>
      </div>

      {/* Si hay copias en el telefono, esto no es una primera vez: es una base
          que se perdio. Lo primero es ofrecer recuperarla. */}
      <Rescate onRestored={setRescate} mensaje={rescate} />

      <ul className="card divide-hairline mb-6">
        {[
          ["Se carga escribiendo, como una nota", "«pasé 100 dólares a cocos», «compré 50 de QQQ a 480»"],
          ["El capital no se mezcla con el rendimiento", "Una línea es el capital aportado. La otra, el valor de la cartera."],
          ["Precios al día", "Acciones, ETFs, CEDEARs, cripto y dólar MEP."],
          ["Todo vive en tu teléfono", "Sin cuenta, sin nube y sin que tus números salgan de acá."],
        ].map(([title, detail]) => (
          <li key={title} className="p-3">
            <div className="text-[13px] font-medium">{title}</div>
            <div className="label mt-1 leading-snug">{detail}</div>
          </li>
        ))}
      </ul>

      <div className="space-y-2">
        <button className="btn btn-primary w-full" onClick={() => setAdding(true)}>
          Cargar mi primer movimiento
        </button>
        <button className="btn w-full" onClick={() => setBulk(true)}>
          Ya tengo todo anotado: pegar la lista
        </button>
        <button className="btn w-full" onClick={demo} disabled={loading}>
          {loading ? "Cargando…" : "Ver con datos de ejemplo"}
        </button>
        <p className="pt-1 text-center text-[11px]" style={{ color: "var(--color-ink-3)" }}>
          Los datos de ejemplo se borran de un toque desde Ajustes.
        </p>
      </div>

      <AddTransaction open={adding} onClose={() => setAdding(false)} />
      <BulkImport open={bulk} onClose={() => setBulk(false)} />
    </div>
  );
}

/**
 * «¿Ya usabas Waltra?». Con copias en el telefono, la lista para recuperar;
 * sin ellas, el camino al estado de la base y a importar un backup.
 */
function Rescate({ onRestored, mensaje }: { onRestored: (m: string) => void; mensaje: string | null }) {
  const [hay, setHay] = useState(false);
  useEffect(() => {
    if (!NATIVE) return;
    void listBackups().then((c) => setHay(c.some((b) => (b.transactions ?? 0) > 0)));
  }, []);
  if (hay) {
    return (
      <div className="card mb-6 p-3" style={{ borderColor: "var(--color-warn)" }}>
        <div className="text-[13px] font-medium">¿Ya usabas Waltra?</div>
        <p className="label mt-1 mb-2 leading-snug">
          Hay copias de tus datos en el teléfono. Recuperar suma lo de la copia a lo que haya.
        </p>
        <BackupList onRestored={onRestored} />
        {mensaje && <p className="label mt-2">{mensaje}</p>}
      </div>
    );
  }
  return (
    <p className="label mb-4">
      ¿Ya usabas Waltra y no ves tus datos?{" "}
      <Link href="/ajustes/datos" className="underline">
        Revisar y recuperar
      </Link>
    </p>
  );
}
