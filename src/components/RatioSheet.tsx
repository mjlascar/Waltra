"use client";

import { useMemo, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Field } from "@/components/ui/Field";
import { newId, useStore } from "@/lib/store";
import { parseLooseNumber } from "@/lib/parse/number";
import { quantity as fmtQty, shortDate } from "@/lib/format";
import { unitsWith, type RatioCheck } from "@/lib/engine/cedear-ratio";

const corto = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: 2 });

/**
 * Corregir los cambios de ratio de un CEDEAR con lo que dicen sus operaciones.
 *
 * El numero y la fecha los proponen los datos; el usuario confirma mirando lo
 * unico que puede comparar sin hacer cuentas: cuantos CEDEARs le muestra su
 * broker. Por eso las unidades resultantes estan a la vista antes de aplicar
 * nada, y se recalculan si toca el ratio o la fecha.
 */
export function RatioSheet({ check, onClose }: { check: RatioCheck | null; onClose: () => void }) {
  const { transactions, portfolio, saveTransaction, deleteTransaction, accounts } = useStore();
  const splits = useMemo(
    () => (check ? (portfolio.splits[check.assetId] ?? []) : []),
    [check, portfolio.splits],
  );
  const delProveedor = useMemo(() => splits.filter((s) => s.source === "proveedor"), [splits]);

  const [filas, setFilas] = useState(() =>
    (check?.changes ?? []).map((c) => ({
      change: c,
      ratioText: corto(c.factor).replace(/\./g, ""),
      date: c.date,
    })),
  );
  const [saving, setSaving] = useState(false);

  const nuevos = useMemo(() => {
    const out: { date: string; ratio: number }[] = [];
    for (const f of filas) {
      const factor = parseLooseNumber(f.ratioText);
      if (factor === null || !(factor > 0)) return null;
      // Lo que el proveedor ya informo dentro de la ventana esta aplicado: a
      // mano va solo lo que falta para llegar al factor.
      const informado = delProveedor
        .filter((s) => s.date > f.change.lastOld && s.date <= f.change.firstNew)
        .reduce((acc, s) => acc * s.ratio, 1);
      const resto = factor / informado;
      if (Math.abs(resto - 1) > 0.001) out.push({ date: f.date, ratio: Number(resto.toFixed(4)) });
    }
    return out;
  }, [filas, delProveedor]);

  if (!check) return null;
  const pos = portfolio.positions.find((p) => p.assetId === check.assetId);
  const ahora = pos?.quantity ?? 0;
  const txsActivo = transactions.filter((t) => t.assetId === check.assetId && t.type !== "split");
  const despues =
    nuevos === null ? null : unitsWith(txsActivo, check.assetId, [...delProveedor, ...nuevos]);
  const manuales = transactions.filter((t) => t.assetId === check.assetId && t.type === "split");

  async function aplicar() {
    if (!check || nuevos === null || saving) return;
    setSaving(true);
    try {
      // Los cargados a mano se reemplazan enteros: dejar alguno viejo y
      // sumar el nuevo es como se llega a multiplicar dos veces.
      for (const t of manuales) await deleteTransaction(t.id);
      const now = new Date().toISOString();
      const cuenta =
        transactions.find((t) => t.assetId === check.assetId && t.type === "buy")?.accountId ??
        accounts[0]?.id ??
        "";
      for (const s of nuevos) {
        await saveTransaction({
          id: newId(),
          date: s.date,
          type: "split",
          accountId: cuenta,
          assetId: check.assetId,
          ratio: s.ratio,
          amount: 0,
          currency: pos?.currency ?? "ARS",
          note: `Según tus operaciones y el precio de ${check.underlying}`,
          createdAt: now,
          updatedAt: now,
        });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Cambios de ratio de ${check.symbol}`}
      footer={
        <div className="flex gap-2">
          <button className="btn btn-ghost flex-1" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn btn-primary flex-[2]"
            disabled={nuevos === null || saving}
            onClick={() => void aplicar()}
          >
            {saving ? "Guardando…" : "Coincide con mi broker"}
          </button>
        </div>
      }
    >
      <p className="label mb-4 leading-relaxed">
        Un CEDEAR es una fracción de {check.underlying}: lo que pagaste por uno, comparado con
        lo que valía {check.underlying} en Nueva York ese día, dice qué fracción era. Tus
        operaciones muestran esto:
      </p>

      {filas.length === 0 && (
        <p className="card p-3 text-[13px] leading-snug">
          Ningún cambio de ratio: todas tus operaciones tienen la misma fracción.
        </p>
      )}
      <div className="space-y-3">
        {filas.map((f, i) => (
          <div key={`${f.change.lastOld}-${f.change.firstNew}`} className="card p-3">
            <p className="text-[13px] leading-snug">
              {f.change.onlyLive
                ? `Después de tu operación del ${shortDate(f.change.lastOld, true)}, según la cotización de hoy`
                : `Entre tu operación del ${shortDate(f.change.lastOld, true)} y la del ${shortDate(f.change.firstNew, true)}`}
              , cada CEDEAR pasó a ser {corto(f.change.measured)}
              {f.change.exact ? `, o sea ${corto(f.change.factor)}` : ", aproximado"}.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Nuevas por cada una">
                <input
                  className="input num"
                  inputMode="decimal"
                  value={f.ratioText}
                  onChange={(e) =>
                    setFilas((prev) => prev.map((x, j) => (j === i ? { ...x, ratioText: e.target.value } : x)))
                  }
                />
              </Field>
              <Field label="Desde">
                <input
                  type="date"
                  className="input"
                  value={f.date}
                  min={f.change.lastOld}
                  max={f.change.firstNew}
                  onChange={(e) =>
                    setFilas((prev) => prev.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))
                  }
                />
              </Field>
            </div>
          </div>
        ))}
      </div>

      {manuales.length > 0 && (
        <p className="label mt-3 leading-snug">
          Cargado ahora:{" "}
          {manuales
            .map((t) => `×${corto(t.ratio ?? 1)} el ${shortDate(t.date.slice(0, 10), true)}`)
            .join(", ")}
          . Se reemplaza por lo de arriba.
        </p>
      )}

      <div className="card mt-4 p-3">
        <p className="text-[13px] leading-snug">
          Con esto tenés <span className="num">{despues === null ? "—" : fmtQty(despues, 4)}</span>{" "}
          {check.symbol}
          {despues !== null && Math.abs(despues - ahora) > 1e-6 && (
            <>
              {" "}
              (hoy la app cuenta <span className="num">{fmtQty(ahora, 4)}</span>)
            </>
          )}
          .
        </p>
        <p className="label mt-2 leading-snug">
          Tiene que ser lo que ves en tu broker. Si ves un número entero un poco menor, te
          pagaron la fracción en pesos: después cargala como una venta de esa fracción. Si
          no coincide, ajustá el ratio hasta que coincida.
        </p>
      </div>
    </Sheet>
  );
}
