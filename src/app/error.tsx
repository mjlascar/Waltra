"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Si algo revienta, la pantalla en blanco es el peor resultado posible en una
 * app de plata: el usuario no sabe si perdio los datos. Este limite explica
 * que sus movimientos siguen guardados y ofrece salidas concretas.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[waltra]", error);
  }, [error]);

  return (
    <div className="pt-16">
      <h1 className="text-[20px] font-semibold tracking-tight">Algo se rompió</h1>
      <p className="mt-3 text-[13px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
        Tus movimientos siguen guardados en el teléfono: esto es un error de la
        pantalla, no de tus datos.
      </p>
      <pre
        className="num mt-4 overflow-x-auto p-3 text-[11px]"
        style={{ background: "var(--color-surface)", border: "1px solid var(--color-line)" }}
      >
        {error.message}
      </pre>
      <div className="mt-4 space-y-2">
        <button className="btn btn-primary w-full" onClick={reset}>
          Reintentar
        </button>
        <Link className="btn w-full" href="/">
          Volver al resumen
        </Link>
        <Link className="btn btn-ghost w-full" href="/ajustes">
          Ir a Ajustes y exportar un backup
        </Link>
      </div>
    </div>
  );
}
