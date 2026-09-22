"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { IconChevron } from "@/components/icons";

/**
 * Marco de una pantalla de ajustes.
 *
 * Cada seccion es una ruta propia y no un panel que se abre por estado: asi
 * el boton fisico de atras de Android vuelve a la lista de ajustes en vez de
 * salirse de la pantalla entera, sin que haya que programar nada para eso.
 */
export function AjustesShell({
  title,
  intro,
  message,
  children,
}: {
  title: string;
  intro?: string;
  message?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="pb-6">
      <header className="mb-4">
        <Link
          href="/ajustes"
          className="label mb-2 inline-flex items-center gap-1"
          style={{ color: "var(--color-ink-2)" }}
        >
          <IconChevron size={12} className="rotate-180" />
          Ajustes
        </Link>
        <h1 className="text-[19px] font-semibold leading-tight tracking-tight">{title}</h1>
        {intro && <p className="label mt-1.5 leading-relaxed">{intro}</p>}
      </header>

      {message && (
        <div className="card mb-4 p-3">
          <p className="text-[12px] leading-snug">{message}</p>
        </div>
      )}

      {children}
    </div>
  );
}
