"use client";

import { useState } from "react";
import { Field } from "@/components/ui/Field";

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
export function ApiKeyField({
  value,
  onChange,
}: {
  value?: string;
  onChange: (key: string | undefined) => void;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const cargada = Boolean(value);

  if (cargada && !editing) {
    return (
      <div className="card p-3">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <span className="text-[13px]">Hay una clave cargada.</span>
          <span className="chip shrink-0 pos">activa</span>
        </div>
        <p className="label mb-3 leading-relaxed">
          Los insights y la lectura asistida de frases salen de tu cuenta de Anthropic.
          Lo que gastan lo ves en tu consola.
        </p>
        <div className="flex gap-2">
          <button
            className="btn btn-sm flex-1"
            onClick={() => {
              setDraft("");
              setEditing(true);
            }}
          >
            Cambiar
          </button>
          <button className="btn btn-sm flex-1" onClick={() => onChange(undefined)}>
            Borrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-3">
      <Field
        label="Clave"
        hint="Se guarda solo en este teléfono y viaja únicamente a api.anthropic.com. No entra en el backup."
      >
        <input
          className="input"
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="sk-ant-…"
        />
      </Field>
      <div className="mt-3 flex gap-2">
        {cargada && (
          <button className="btn btn-sm flex-1" onClick={() => setEditing(false)}>
            Cancelar
          </button>
        )}
        <button
          className="btn btn-primary btn-sm flex-[2]"
          disabled={draft.trim().length < 20}
          onClick={() => {
            onChange(draft.trim());
            setDraft("");
            setEditing(false);
          }}
        >
          Guardar
        </button>
      </div>
      <p className="label mt-3 leading-relaxed">
        Se saca de console.anthropic.com, en API keys. Es tuya: la app no la comparte
        con nadie y cada uno paga lo suyo.
      </p>
    </div>
  );
}
