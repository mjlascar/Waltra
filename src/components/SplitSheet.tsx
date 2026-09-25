"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Field } from "@/components/ui/Field";
import { newId, useStore } from "@/lib/store";
import { parseLooseNumber } from "@/lib/parse/number";
import { quantity as fmtQty } from "@/lib/format";
import { today } from "@/lib/date";

/**
 * El ratio que sugieren los precios, redondeado a algo que un broker usaria.
 *
 * Lo pagado sobre lo cotizado da 2,48 y no 2,5 porque el precio tambien se
 * movio. Los cambios de ratio son numeros redondos, asi que se sugiere el
 * medio entero mas cercano si esta a menos de un 5%; si no, el numero tal
 * cual. Es una sugerencia: el que confirma es el usuario, con lo que ve en su
 * broker.
 */
export function suggestRatio(factor: number): number {
  const redondo = Math.round(factor * 2) / 2;
  return redondo > 0 && Math.abs(factor / redondo - 1) < 0.05 ? redondo : Number(factor.toFixed(2));
}

/** Un ratio sin ceros de relleno: 2,5 y no 2,50. */
const corto = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: 2 });

/**
 * Registrar un cambio de ratio o un split de una posicion.
 *
 * Se pide el ratio y no las unidades de despues: si el broker pago en
 * efectivo la fraccion que no llego a una unidad entera, "ahora tengo 22"
 * daria 2,44 y no el 2,5 que de verdad se aplico, y la valuacion quedaria
 * corrida contra los precios del proveedor, que ajustan por 2,5.
 */
export function SplitSheet({
  assetId,
  suggested,
  suggestedDate,
  onClose,
}: {
  assetId: string | null;
  /** Lo pagado sobre lo cotizado, si viene de una compra que no cierra. */
  suggested?: number;
  /** Desde cuando rige, segun las compras. Ver `PriceMismatch.suggestedDate`. */
  suggestedDate?: string | null;
  onClose: () => void;
}) {
  const { portfolio, saveTransaction, accounts } = useStore();
  const pos = portfolio.positions.find((p) => p.assetId === assetId);
  const [ratioText, setRatioText] = useState(
    suggested ? String(suggestRatio(suggested)).replace(".", ",") : "",
  );
  // La fecha importa: una compra hecha despues del cambio, pero anterior a
  // la fecha cargada, se multiplica por el ratio. Si las compras la dejan
  // ver, se propone esa; si no, hoy, que con compras solo al precio viejo da
  // lo mismo que la real.
  const [date, setDate] = useState(suggestedDate ?? today());
  const [saving, setSaving] = useState(false);

  if (!assetId || !pos) return null;
  const ratio = parseLooseNumber(ratioText) ?? undefined;
  const valido = ratio !== undefined && ratio > 0 && ratio !== 1;
  const despues = valido ? pos.quantity * ratio : undefined;

  async function guardar() {
    if (!valido || saving || !pos) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      await saveTransaction({
        id: newId(),
        date,
        type: "split",
        // El split rige para toda la posicion, en todas las cuentas; la cuenta
        // se anota solo para que el movimiento aparezca en algun lado.
        accountId: pos.accounts[0]?.accountId ?? accounts[0]?.id ?? "",
        assetId: pos.assetId,
        ratio,
        amount: 0,
        currency: pos.currency,
        createdAt: now,
        updatedAt: now,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Cambio de ratio"
      footer={
        <div className="flex gap-2">
          <button className="btn btn-ghost flex-1" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary flex-[2]" disabled={!valido || saving} onClick={guardar}>
            {saving ? "Guardando…" : "Registrar"}
          </button>
        </div>
      }
    >
      <p className="label mb-4 leading-relaxed">
        Cuando un CEDEAR cambia de ratio, o una acción se divide, cada unidad que tenías
        pasa a ser varias, cada una más barata. La plata es la misma; cambia cómo se
        cuenta. Tu broker te acredita las unidades nuevas.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Nuevas por cada una">
          <input
            className="input num"
            inputMode="decimal"
            value={ratioText}
            onChange={(e) => setRatioText(e.target.value)}
            placeholder="2,5"
          />
        </Field>
        <Field label="Desde">
          <input
            type="date"
            className="input"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
      </div>

      <div className="card mt-4 p-3">
        <p className="text-[13px] leading-snug">
          {pos.symbol}: tenías <span className="num">{fmtQty(pos.quantity, 6)}</span>
          {despues !== undefined ? (
            <>
              {" "}
              → quedás con <span className="num">{fmtQty(despues, 6)}</span>
            </>
          ) : null}
          .
        </p>
        {suggested && (
          <p className="label mt-2 leading-snug">
            Pagaste unas {corto(suggested)} veces el precio histórico de esos días, que el
            proveedor ya da ajustado. Eso sugiere un ratio de {corto(suggestRatio(suggested))}.
            Confirmalo con lo que ves en tu broker.
          </p>
        )}
        <p className="label mt-2 leading-snug">
          {suggestedDate
            ? `La fecha propuesta es la de tu primera compra al precio nuevo. `
            : ""}
          La fecha importa si compraste después del cambio: tiene que quedar antes de tu
          primera compra al precio nuevo, o esas unidades se multiplican por el ratio.
        </p>
        <p className="label mt-2 leading-snug">
          Si tu broker te pagó en efectivo la fracción que no llegó a una unidad entera,
          cargala después como una venta de esa fracción.
        </p>
      </div>
    </Sheet>
  );
}
