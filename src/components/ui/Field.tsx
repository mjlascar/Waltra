"use client";

import type { ReactNode } from "react";

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="eyebrow mb-1.5 block">{label}</span>
      {children}
      {hint && (
        <span className="mt-1 block text-[11px]" style={{ color: "var(--color-ink-3)" }}>
          {hint}
        </span>
      )}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          // aria-pressed es lo que hace que un lector de pantalla anuncie cual
          // opcion esta elegida: el fondo mas claro no le dice nada.
          aria-pressed={option.value === value}
          data-active={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Un selector chico, para ir en la misma fila que un título: el orden de una
 * lista, el rango de un gráfico, la moneda. `Segmented` ocupa el ancho entero
 * y compite con el contenido.
 */
export function MiniSegmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; aria?: string }[];
  onChange: (value: T) => void;
  /** Qué elige, para un lector de pantalla. */
  label?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex shrink-0 border"
      style={{ borderColor: "var(--color-line)" }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-label={o.aria}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className="num min-w-[34px] px-1.5 py-[3px] text-[11px]"
          style={
            value === o.value
              ? { background: "var(--color-ink)", color: "var(--color-bg)" }
              : { color: "var(--color-ink-3)" }
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
