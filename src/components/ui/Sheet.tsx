"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { IconClose } from "@/components/icons";

/**
 * Panel que sube desde abajo. Es el patron correcto en un telefono: el
 * contenido queda al alcance del pulgar y el fondo sigue dando contexto.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* El fondo cierra al tocarlo, pero no es un control anunciable: para
          teclado y lectores de pantalla estan la X del encabezado y Escape. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
      />
      {/* El panel es una columna flexible: el encabezado y el pie miden lo que
          miden, y el cuerpo se queda con el resto. Antes el alto del cuerpo se
          calculaba a mano restando 76px de pie, tuviera pie o no, asi que en
          las hojas sin pie sobraba ese hueco y el ultimo boton quedaba contra
          el borde de abajo. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex w-full flex-col"
        style={{
          background: "var(--color-bg)",
          borderTop: "1px solid var(--color-line-strong)",
          maxHeight: "92dvh",
          marginInline: "auto",
          maxWidth: 560,
        }}
      >
        <div
          className="flex shrink-0 items-center justify-between px-4"
          style={{ height: 52, borderBottom: "1px solid var(--color-line)" }}
        >
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button onClick={onClose} className="p-2 -mr-2" aria-label="Cerrar" style={{ color: "var(--color-ink-2)" }}>
            <IconClose size={18} />
          </button>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
          style={{
            // Sin pie, el margen inferior del sistema lo tiene que dejar el
            // propio cuerpo: es lo ultimo que hay antes del borde.
            paddingBottom: footer ? 16 : "calc(16px + env(safe-area-inset-bottom))",
          }}
        >
          {children}
        </div>

        {footer && (
          <div
            className="shrink-0 px-4 py-3"
            style={{
              borderTop: "1px solid var(--color-line)",
              paddingBottom: "calc(12px + env(safe-area-inset-bottom))",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
