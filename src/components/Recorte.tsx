"use client";

import { useRef, useState, type PointerEvent } from "react";

/** Lo que se saca de cada borde, como fraccion del lado. */
interface Margenes {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

type Borde = keyof Margenes;

const SIN_RECORTE: Margenes = { top: 0, bottom: 0, left: 0, right: 0 };
/** Lo minimo que queda de la imagen, para que un borde no pase al otro. */
const MINIMO = 0.08;
/** Cuan cerca de un borde hay que tocar para agarrarlo, en pixeles. */
const ALCANCE = 36;

/**
 * Recortar una captura antes de mandarla: se arrastran los bordes. Lo que
 * queda afuera no viaja al modelo, que es la promesa del aviso de arriba (el
 * saldo, el nombre, lo que no tiene que ver con los movimientos).
 */
export function Recorte({
  file,
  src,
  onDone,
  onCancel,
}: {
  file: File;
  src: string;
  onDone: (recortada: File) => void;
  onCancel: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [m, setM] = useState<Margenes>(SIN_RECORTE);
  const [borde, setBorde] = useState<Borde | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function posicion(e: PointerEvent) {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, w: r.width, h: r.height };
  }

  function agarrar(e: PointerEvent<HTMLDivElement>) {
    const { x, y, w, h } = posicion(e);
    const distancias: [Borde, number][] = [
      ["top", Math.abs(y - m.top) * h],
      ["bottom", Math.abs(1 - m.bottom - y) * h],
      ["left", Math.abs(x - m.left) * w],
      ["right", Math.abs(1 - m.right - x) * w],
    ];
    const [cerca, d] = distancias.sort((a, b) => a[1] - b[1])[0];
    if (d > ALCANCE) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setBorde(cerca);
  }

  function mover(e: PointerEvent<HTMLDivElement>) {
    if (!borde) return;
    const { x, y } = posicion(e);
    const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
    setM((prev) => {
      switch (borde) {
        case "top":
          return { ...prev, top: clamp(y, 1 - prev.bottom - MINIMO) };
        case "bottom":
          return { ...prev, bottom: clamp(1 - y, 1 - prev.top - MINIMO) };
        case "left":
          return { ...prev, left: clamp(x, 1 - prev.right - MINIMO) };
        case "right":
          return { ...prev, right: clamp(1 - x, 1 - prev.left - MINIMO) };
      }
    });
  }

  async function aplicar() {
    setBusy(true);
    setError(null);
    try {
      const bmp = await createImageBitmap(file);
      try {
        const sx = Math.round(bmp.width * m.left);
        const sy = Math.round(bmp.height * m.top);
        const sw = Math.max(1, Math.round(bmp.width * (1 - m.left - m.right)));
        const sh = Math.max(1, Math.round(bmp.height * (1 - m.top - m.bottom)));
        const canvas = document.createElement("canvas");
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("El teléfono no dejó recortar la imagen.");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, sw, sh);
        ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
        const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.95));
        if (!blob) throw new Error("El teléfono no dejó recortar la imagen.");
        onDone(new File([blob], file.name.replace(/\.\w+$/, "") + "-recorte.jpg", { type: "image/jpeg" }));
      } finally {
        bmp.close();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const sombra = "rgba(0,0,0,0.62)";
  const linea = "var(--color-ink)";
  const cambiado = m.top + m.bottom + m.left + m.right > 0.001;

  return (
    <div className="space-y-2">
      <p className="label leading-snug">
        Arrastrá los bordes. Lo oscuro no se manda.
      </p>
      <div className="flex justify-center">
        <div
          ref={boxRef}
          className="relative inline-block max-w-full select-none"
          style={{ touchAction: "none" }}
          onPointerDown={agarrar}
          onPointerMove={mover}
          onPointerUp={() => setBorde(null)}
          onPointerCancel={() => setBorde(null)}
          data-testid="recorte"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="Captura a recortar" className="block max-w-full" style={{ maxHeight: "58vh" }} draggable={false} />
          <div className="absolute inset-x-0 top-0" style={{ height: `${m.top * 100}%`, background: sombra }} />
          <div className="absolute inset-x-0 bottom-0" style={{ height: `${m.bottom * 100}%`, background: sombra }} />
          <div
            className="absolute left-0"
            style={{ top: `${m.top * 100}%`, bottom: `${m.bottom * 100}%`, width: `${m.left * 100}%`, background: sombra }}
          />
          <div
            className="absolute right-0"
            style={{ top: `${m.top * 100}%`, bottom: `${m.bottom * 100}%`, width: `${m.right * 100}%`, background: sombra }}
          />
          <div
            className="pointer-events-none absolute"
            style={{
              top: `${m.top * 100}%`,
              bottom: `${m.bottom * 100}%`,
              left: `${m.left * 100}%`,
              right: `${m.right * 100}%`,
              border: `2px solid ${linea}`,
            }}
          >
            {/* Agarraderas en el medio de cada borde, para que se vea que se arrastran. */}
            <span className="absolute left-1/2 top-0 h-[6px] w-10 -translate-x-1/2 -translate-y-1/2" style={{ background: linea }} />
            <span className="absolute bottom-0 left-1/2 h-[6px] w-10 -translate-x-1/2 translate-y-1/2" style={{ background: linea }} />
            <span className="absolute left-0 top-1/2 h-10 w-[6px] -translate-x-1/2 -translate-y-1/2" style={{ background: linea }} />
            <span className="absolute right-0 top-1/2 h-10 w-[6px] -translate-y-1/2 translate-x-1/2" style={{ background: linea }} />
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <button className="btn btn-sm flex-1" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button className="btn btn-sm flex-1" onClick={() => setM(SIN_RECORTE)} disabled={busy || !cambiado}>
          Deshacer
        </button>
        <button className="btn btn-primary btn-sm flex-1" onClick={() => void aplicar()} disabled={busy || !cambiado}>
          {busy ? "Recortando…" : "Recortar"}
        </button>
      </div>
      {error && <p className="text-[12px] neg leading-snug">{error}</p>}
    </div>
  );
}
