"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { loadDemoData } from "@/lib/demo";
import { AddTransaction } from "@/components/AddTransaction";
import { BulkImport } from "@/components/BulkImport";

/**
 * Primera pantalla. No pide configurar nada: o cargas tu primer movimiento, o
 * mirás cómo se ve con datos de ejemplo. Un formulario de alta de cuentas
 * antes de ver nada es la forma mas rapida de que alguien abandone.
 */
export function EmptyStart() {
  const { db, refresh } = useStore();
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

  return (
    <div className="pt-10 pb-6">
      <div className="mb-8">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">Waltra</h1>
        <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
          Cocos y Binance en un solo lugar, con las cuentas claras: cuánto pusiste,
          cuánto vale hoy y cuánto de eso es ganancia de verdad.
        </p>
      </div>

      <ul className="card divide-hairline mb-6">
        {[
          ["Cargás como si escribieras una nota", "«pasé 100 dólares a cocos», «compré 50 de QQQ a 480»"],
          ["El capital no se mezcla con el rendimiento", "Una línea es lo que pusiste. La otra, lo que vale."],
          ["Precios al día", "Acciones, ETFs, CEDEARs, cripto y dólar MEP."],
          ["Todo vive en tu teléfono", "Sin cuenta, sin nube, sin nadie mirando tus números."],
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
