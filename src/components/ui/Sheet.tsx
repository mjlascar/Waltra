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
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full"
        style={{
          background: "var(--color-bg)",
          borderTop: "1px solid var(--color-line-strong)",
          maxHeight: "92vh",
          marginInline: "auto",
          maxWidth: 560,
        }}
      >
        <div
          className="flex items-center justify-between px-4"
          style={{ height: 52, borderBottom: "1px solid var(--color-line)" }}
        >
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button onClick={onClose} className="p-2 -mr-2" aria-label="Cerrar" style={{ color: "var(--color-ink-2)" }}>
            <IconClose size={18} />
          </button>
        </div>

        <div
          className="overflow-y-auto px-4 py-4"
          style={{ maxHeight: "calc(92vh - 52px - 76px)" }}
        >
          {children}
        </div>

        {footer && (
          <div
            className="px-4 py-3"
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
