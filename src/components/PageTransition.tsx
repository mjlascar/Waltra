"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Cada pantalla entra subiendo apenas. La clave es la ruta: al cambiar de
 * pestaña el contenido se vuelve a montar y la animacion corre otra vez; al
 * quedarse en la misma no se repite con cada refresco de precios.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const ruta = usePathname();
  return (
    <div key={ruta} className="page-enter">
      {children}
    </div>
  );
}
