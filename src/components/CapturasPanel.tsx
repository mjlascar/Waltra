"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Field } from "@/components/ui/Field";
import { useStore } from "@/lib/store";
import { ON_DEVICE, describeBackendError, readCaptures } from "@/lib/backend";
import { keyFor, providerInfo, resolveModel, resolveProvider } from "@/lib/insights/providers";
import { today } from "@/lib/date";

/** Cuantas capturas por vez: mas que esto conviene leerlo en dos tandas. */
const MAX_CAPTURAS = 8;

/**
 * Elegir capturas de la actividad de un broker y pasarlas a lineas.
 *
 * Lo que devuelve el modelo cae en el texto de "Pegar movimientos", y de ahi
 * en adelante es la misma revision de siempre: se ve linea por linea que se
 * entendio antes de guardar. Sin clave de API queda el camino de copiar el
 * pedido y pegar la respuesta.
 */
export function CapturasPanel({
  accountId,
  onAccountChange,
  onText,
}: {
  accountId: string;
  onAccountChange: (id: string) => void;
  onText: (texto: string) => void;
}) {
  const { accounts, settings, backend } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const provider = resolveProvider(settings.provider);
  const nombre = providerInfo(provider).label;
  const sinClave = ON_DEVICE && !keyFor(provider, settings);

  // Las miniaturas son direcciones locales de cada archivo: se liberan cuando
  // cambia la seleccion, o quedarian ocupando memoria.
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  async function leer() {
    setBusy(true);
    setError(null);
    setAviso(null);
    try {
      const { prepararCapturas, MAX_PEDAZOS } = await import("@/lib/capturas-imagen");
      const images = await prepararCapturas(files);
      if (images.length > MAX_PEDAZOS) {
        setError("Son muchas capturas largas para una sola vez: mandá la mitad y después el resto.");
        return;
      }
      const r = await readCaptures(
        { provider, model: resolveModel(provider, settings.model), today: today(), images },
        backend(),
      );
      if (!r.texto.trim()) {
        setAviso("No encontré movimientos en esas capturas.");
        return;
      }
      onText(r.texto);
      setFiles([]);
      setAviso(r.mock ? "Lectura de prueba (WALTRA_MOCK=1): no se mandó nada." : null);
    } catch (err) {
      setError(describeBackendError(err));
    } finally {
      setBusy(false);
    }
  }

  async function copiarPedido() {
    setError(null);
    const { pedidoExterno } = await import("@/lib/insights/capturas");
    try {
      await navigator.clipboard.writeText(pedidoExterno(today()));
      setAviso("Pedido copiado. Mandáselo con las capturas y pegá la respuesta abajo.");
    } catch {
      setError("No se pudo copiar solo.");
    }
  }

  return (
    <div className="mb-3 space-y-3">
      <Field label="Cuenta">
        <select className="input" value={accountId} onChange={(e) => onAccountChange(e.target.value)}>
          {accounts
            .filter((a) => !a.archived)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </Field>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const nuevas = [...(e.target.files ?? [])];
          setFiles((prev) => [...prev, ...nuevas].slice(0, MAX_CAPTURAS));
          e.target.value = "";
        }}
      />

      {previews.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto">
          {previews.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={src}
              src={src}
              alt={`Captura ${i + 1}`}
              className="h-20 w-auto shrink-0"
              style={{ border: "1px solid var(--color-line)" }}
            />
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button className="btn btn-sm flex-1" onClick={() => fileRef.current?.click()} disabled={busy}>
          {files.length ? "Sumar capturas" : "Elegir capturas"}
        </button>
        {files.length > 0 && (
          <button className="btn btn-sm flex-1" onClick={() => setFiles([])} disabled={busy}>
            Quitar
          </button>
        )}
      </div>

      {sinClave ? (
        <div>
          <p className="label leading-snug">
            Sin clave de {nombre}: copiá el pedido, mandáselo con las capturas desde su app y
            pegá la respuesta abajo.
          </p>
          <button className="btn btn-sm mt-2 w-full" onClick={() => void copiarPedido()}>
            Copiar el pedido
          </button>
        </div>
      ) : (
        <>
          <button
            className="btn btn-primary btn-sm w-full"
            disabled={files.length === 0 || busy}
            onClick={() => void leer()}
          >
            {busy ? "Leyendo…" : `Leer ${files.length || ""} ${files.length === 1 ? "captura" : "capturas"} con ${nombre}`.replace("  ", " ")}
          </button>
          <p className="label leading-snug">
            Las capturas viajan a {nombre} tal como están. Recortá lo que no quieras mandar.
          </p>
        </>
      )}

      {aviso && <p className="label leading-snug">{aviso}</p>}
      {error && <p className="text-[12px] neg leading-snug">{error}</p>}
    </div>
  );
}
