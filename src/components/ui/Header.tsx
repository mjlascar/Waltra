"use client";

import Link from "next/link";
import { IconRefresh, IconSettings } from "@/components/icons";
import { useStore } from "@/lib/store";
import { relativeTime } from "@/lib/format";

/** Cabecera comun: nombre de la vista, estado de datos y acceso a ajustes. */
export function Header({ title }: { title: string }) {
  const { sync, refresh, settings } = useStore();

  const status =
    sync.status === "syncing"
      ? "actualizando…"
      : sync.status === "error"
        ? "sin conexión"
        : settings.lastQuoteSync
          ? `precios ${relativeTime(settings.lastQuoteSync)}`
          : "sin precios aún";

  return (
    <header className="mb-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[19px] font-semibold leading-tight tracking-tight">{title}</h1>
        <p
          className="eyebrow mt-1 truncate"
          style={{ color: sync.status === "error" ? "var(--color-warn)" : undefined }}
        >
          {status}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={() => void refresh({ force: false })}
          aria-label="Actualizar precios"
          className="p-2"
          style={{ color: "var(--color-ink-2)" }}
          disabled={sync.status === "syncing"}
        >
          <IconRefresh size={18} className={sync.status === "syncing" ? "opacity-40" : ""} />
        </button>
        <Link href="/ajustes" aria-label="Ajustes" className="p-2" style={{ color: "var(--color-ink-2)" }}>
          <IconSettings size={18} />
        </Link>
      </div>
    </header>
  );
}
