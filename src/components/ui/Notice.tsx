"use client";

import type { ReactNode } from "react";
import { IconWarning } from "@/components/icons";

/** Aviso de un renglon. El icono acompania siempre al color. */
export function Notice({
  tone = "warn",
  children,
}: {
  tone?: "warn" | "info";
  children: ReactNode;
}) {
  const color = tone === "warn" ? "var(--color-warn)" : "var(--color-ink-2)";
  return (
    <div
      className="mb-3 flex items-start gap-2 p-2.5"
      style={{
        border: "1px solid var(--color-line-strong)",
        background: "var(--color-surface)",
        color,
      }}
    >
      <IconWarning size={14} className="mt-0.5 shrink-0" />
      <p className="text-[12px] leading-snug">{children}</p>
    </div>
  );
}
