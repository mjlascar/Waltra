"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Field, Segmented } from "@/components/ui/Field";
import { IconTrash } from "@/components/icons";
import { useStore } from "@/lib/store";
import { money } from "@/lib/format";
import { searchCatalog } from "@/lib/catalog";
import type { Asset, Currency, QuoteSource } from "@/lib/types";

type Prueba =
  | { estado: "inactiva" }
  | { estado: "probando" }
  | { estado: "ok"; precio: number; moneda: Currency }
  | { estado: "error"; mensaje: string };

/**
 * Editor de un activo, con prueba en vivo del simbolo.
 *
 * Si un activo no cotiza, adivinar cual de los cuatro proveedores lo tiene y
 * con que simbolo es exactamente el tipo de cosa que hace abandonar una app.
 * El boton de probar contesta en el momento, antes de guardar.
 */
export function AssetEditor({
  asset,
  canDelete,
  onClose,
  onSave,
  onDelete,
}: {
  asset: Asset;
  canDelete: boolean;
  onClose: () => void;
  onSave: (asset: Asset) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { apiHeaders } = useStore();
  const [draft, setDraft] = useState(asset);
  const [prueba, setPrueba] = useState<Prueba>({ estado: "inactiva" });

  const sugerencias = searchCatalog(draft.symbol, 4).filter(
    (entry) => entry.sourceSymbol !== draft.sourceSymbol,
  );

  async function probar() {
    setPrueba({ estado: "probando" });
    try {
      const res = await fetch("/api/market", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          refs: [
            {
              assetId: "prueba",
              symbol: draft.symbol,
              source: draft.source,
              sourceSymbol: draft.sourceSymbol,
              currency: draft.currency,
            },
          ],
          history: [],
          includeFx: false,
        }),
      });
      const data = await res.json();
      const quote = data.quotes?.[0];
      if (quote?.price != null) {
        setPrueba({ estado: "ok", precio: quote.price, moneda: quote.currency });
      } else {
        setPrueba({
          estado: "error",
          mensaje: quote?.error ?? "el proveedor no devolvió precio",
        });
      }
    } catch (err) {
      setPrueba({ estado: "error", mensaje: err instanceof Error ? err.message : String(err) });
    }
  }

  const set = (patch: Partial<Asset>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setPrueba({ estado: "inactiva" });
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={asset.symbol}
      footer={
        <div className="flex gap-2">
          {canDelete && (
            <button
              className="btn"
              style={{ borderColor: "var(--color-neg)", color: "var(--color-neg)" }}
              onClick={onDelete}
              aria-label="Borrar activo"
            >
              <IconTrash size={16} />
            </button>
          )}
          <button className="btn btn-primary flex-1" onClick={() => void onSave(draft)}>
            Guardar
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Nombre">
          <input
            className="input"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>

        <Field
          label="Fuente del precio"
          hint="Binance para cripto, Yahoo para acciones y ETFs, BYMA para el mercado local."
        >
          <select
            className="input"
            value={draft.source}
            onChange={(e) => set({ source: e.target.value as QuoteSource })}
          >
            <option value="yahoo">Yahoo Finance</option>
            <option value="binance">Binance</option>
            <option value="byma">BYMA / data912</option>
            <option value="manual">Precio a mano</option>
          </select>
        </Field>

        <Field
          label="Símbolo en la fuente"
          hint={
            draft.source === "binance"
              ? "Con el par: BTCUSDT."
              : draft.source === "byma"
                ? "El ticker local: GGAL, AL30."
                : "El ticker de Yahoo: QQQ, AAPL, GGAL.BA."
          }
        >
          <input
            className="input num"
            value={draft.sourceSymbol}
            autoCapitalize="characters"
            onChange={(e) => set({ sourceSymbol: e.target.value.toUpperCase() })}
          />
        </Field>

        {draft.source !== "manual" && (
          <>
            <button
              className="btn btn-sm w-full"
              onClick={probar}
              disabled={prueba.estado === "probando" || !draft.sourceSymbol.trim()}
            >
              {prueba.estado === "probando" ? "Probando…" : "Probar este símbolo"}
            </button>

            {prueba.estado === "ok" && (
              <p className="text-[12px] pos">
                Anda: {draft.sourceSymbol} cotiza {money(prueba.precio, prueba.moneda)}.
              </p>
            )}
            {prueba.estado === "error" && (
              <div>
                <p className="text-[12px] neg">No cotizó: {prueba.mensaje}</p>
                {sugerencias.length > 0 && (
                  <>
                    <p className="label mt-2">Probá con alguno de estos:</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {sugerencias.map((entry) => (
                        <button
                          key={`${entry.source}-${entry.sourceSymbol}`}
                          className="chip"
                          onClick={() =>
                            set({
                              source: entry.source,
                              sourceSymbol: entry.sourceSymbol,
                              currency: entry.currency,
                              kind: entry.kind,
                            })
                          }
                        >
                          {entry.sourceSymbol}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {draft.source === "manual" && (
          <Field label="Precio actual" hint="Lo actualizás vos cuando quieras.">
            <input
              className="input num"
              inputMode="decimal"
              value={draft.manualPrice ?? ""}
              onChange={(e) => set({ manualPrice: Number(e.target.value) || undefined })}
            />
          </Field>
        )}

        <Field label="Moneda de cotización">
          <Segmented
            value={draft.currency}
            onChange={(v) => set({ currency: v as Currency })}
            options={[
              { value: "USD", label: "USD" },
              { value: "ARS", label: "ARS" },
            ]}
          />
        </Field>

        {!canDelete && (
          <p className="label leading-snug">
            No se puede borrar: tiene movimientos asociados. Borrá primero esos
            movimientos.
          </p>
        )}
      </div>
    </Sheet>
  );
}
