"use client";

import Link from "next/link";
import { IconRefresh, IconSettings } from "@/components/icons";
import { useStore } from "@/lib/store";
import { relativeTime } from "@/lib/format";

/**
 * Cuan vigente es la cotizacion que se esta mostrando.
 *
 * Cuando acaba de refrescarse no hace falta el detalle temporal: lo que el
 * usuario necesita saber es que el numero de la pantalla es el de ahora.
 */
function precioStatus(lastSync: string): string {
  const minutos = (Date.now() - Date.parse(lastSync)) / 60_000;
  if (!Number.isFinite(minutos)) return "Sin cotizaciones";
  if (minutos < 5) return "Cotizaciones al día";
  return `Cotizaciones de ${relativeTime(lastSync)}`;
}

/**
 * Cabecera comun: el nombre de la vista y nada mas. El estado de los precios
 * viaja en el boton de actualizar (su rotulo, y en color de aviso sin
 * conexion): un subtitulo fijo en cada pantalla repetia "al dia" sin decir
 * nada la mayor parte del tiempo.
 */
export function Header({ title }: { title: string }) {
  const { sync, refresh, settings } = useStore();

  const status =
    sync.status === "syncing"
      ? "Actualizando precios…"
      : sync.status === "error"
        ? "Sin conexión"
        : settings.lastQuoteSync
          ? precioStatus(settings.lastQuoteSync)
          : "Sin cotizaciones";

  return (
    <header className="mb-4 flex items-center justify-between gap-3">
      <h1 className="min-w-0 truncate text-[19px] font-semibold leading-tight tracking-tight">
        {title}
      </h1>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={() => void refresh({ force: false })}
          aria-label={`${status}. Actualizar precios`}
          title={status}
          className="p-2"
          style={{ color: sync.status === "error" ? "var(--color-warn)" : "var(--color-ink-2)" }}
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
