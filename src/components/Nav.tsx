"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AddTransaction } from "@/components/AddTransaction";
import {
  IconActivity,
  IconHoldings,
  IconInsights,
  IconOverview,
  IconPlus,
} from "@/components/icons";

const ITEMS = [
  { href: "/", label: "Resumen", Icon: IconOverview },
  { href: "/cartera", label: "Cartera", Icon: IconHoldings },
  { href: "/movimientos", label: "Movimientos", Icon: IconActivity },
  { href: "/insights", label: "Insights", Icon: IconInsights },
];

/**
 * La ruta sin la barra final.
 *
 * El build del APK exporta cada pantalla como carpeta, asi que el navegador
 * reporta "/cartera/" y no "/cartera". Sin normalizar, ninguna pestana se
 * marcaba como activa salvo el inicio, que es "/" en los dos casos.
 */
function samePath(pathname: string, href: string): boolean {
  const limpio = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return limpio === href;
}

export function Nav() {
  const pathname = usePathname();
  const [adding, setAdding] = useState(false);

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40"
        style={{
          background: "var(--color-bg)",
          borderTop: "1px solid var(--color-line)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div className="mx-auto flex max-w-[560px] items-stretch">
          {ITEMS.slice(0, 2).map((item) => (
            <NavItem key={item.href} {...item} active={samePath(pathname, item.href)} />
          ))}

          {/* Cargar un movimiento es lo que mas se hace: va al centro, al
              alcance del pulgar, y no compite con la navegacion. */}
          <button
            onClick={() => setAdding(true)}
            aria-label="Agregar movimiento"
            className="flex flex-1 items-center justify-center"
            style={{ height: 56 }}
          >
            <span
              className="flex items-center justify-center"
              style={{ width: 38, height: 38, background: "var(--color-ink)", color: "var(--color-bg)" }}
            >
              <IconPlus size={20} />
            </span>
          </button>

          {ITEMS.slice(2).map((item) => (
            <NavItem key={item.href} {...item} active={samePath(pathname, item.href)} />
          ))}
        </div>
      </nav>

      <AddTransaction open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function NavItem({
  href,
  label,
  Icon,
  active,
}: {
  href: string;
  label: string;
  Icon: (props: { size?: number }) => React.ReactElement;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      // Sin rotulo visible, el nombre de la pestana tiene que viajar igual: es
      // lo unico que anuncia un lector de pantalla, y `aria-current` dice cual
      // es la actual sin depender de la barrita ni del color.
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className="relative flex flex-1 items-center justify-center"
      style={{ height: 56, color: active ? "var(--color-ink)" : "var(--color-ink-3)" }}
    >
      <Icon size={22} />
      {/* Marca de seleccion que no depende solo del color. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: 26,
          height: 2,
          background: active ? "var(--color-ink)" : "transparent",
        }}
      />
    </Link>
  );
}
