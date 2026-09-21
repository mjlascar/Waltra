"use client";

import type { ReactNode } from "react";

/** Celda de metrica: etiqueta arriba, numero abajo, sin adornos. */
export function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: "pos" | "neg" | "plain";
  hint?: string;
}) {
  return (
    <div className="p-3">
      <div className="eyebrow mb-1.5">{label}</div>
      <div
        className={`num text-[16px] leading-none ${tone === "pos" ? "pos" : tone === "neg" ? "neg" : ""}`}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-1 text-[10px] leading-tight" style={{ color: "var(--color-ink-3)" }}>
          {hint}
        </div>
      )}
    </div>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <h2 className="eyebrow">{children}</h2>
      {action}
    </div>
  );
}
