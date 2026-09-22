"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Field, Segmented } from "@/components/ui/Field";
import { IconTrash } from "@/components/icons";
import type { Account, Broker, Currency } from "@/lib/types";

export function AccountEditor({
  account, canDelete, onClose, onSave, onDelete,
}: {
  account: Account;
  canDelete: boolean;
  onClose: () => void;
  onSave: (a: Account) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(account);
  return (
    <Sheet
      open
      onClose={onClose}
      title={account.name || "Nueva cuenta"}
      footer={
        <div className="flex gap-2">
          {canDelete && (
            <button
              className="btn"
              style={{ borderColor: "var(--color-neg)", color: "var(--color-neg)" }}
              onClick={onDelete}
            >
              <IconTrash size={16} />
            </button>
          )}
          <button
            className="btn btn-primary flex-1"
            disabled={!draft.name.trim()}
            onClick={() => void onSave({ ...draft, name: draft.name.trim() })}
          >
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
            autoFocus
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Cocos Capital"
          />
        </Field>
        <Field label="Tipo" hint="Define los alias que entiende la carga rápida.">
          <select
            className="input"
            value={draft.broker}
            onChange={(e) => setDraft({ ...draft, broker: e.target.value as Broker })}
          >
            <option value="cocos">Cocos Capital</option>
            <option value="binance">Binance</option>
            <option value="other">Otro</option>
          </select>
        </Field>
        <Field label="Moneda habitual">
          <Segmented
            value={draft.currency}
            onChange={(v) => setDraft({ ...draft, currency: v as Currency })}
            options={[
              { value: "USD", label: "USD" },
              { value: "ARS", label: "ARS" },
            ]}
          />
        </Field>
        {!canDelete && (
          <p className="label leading-snug">
            No se puede borrar: tiene movimientos cargados o es la única cuenta.
          </p>
        )}
      </div>
    </Sheet>
  );
}

/**
 * La clave de Anthropic del usuario, en el APK.
 *
 * En la version web esta clave vive en el servidor y la pantalla ni la
 * menciona. En el telefono no hay servidor, asi que la pone el usuario y se
 * guarda junto al resto de sus datos, en el almacenamiento privado de la app.
 *
 * Nunca se muestra despues de guardada: no hay nada que ganar en volver a
 * verla y si algo que perder si alguien mira por encima del hombro. Tampoco
 * entra en el backup (ver `exportBackup`), porque ese archivo termina en
 * Drive o en un mail a uno mismo.
 */
