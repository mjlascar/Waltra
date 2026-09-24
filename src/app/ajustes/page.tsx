"use client";

import Link from "next/link";
import { Header } from "@/components/ui/Header";
import { IconChevron } from "@/components/icons";
import { useStore } from "@/lib/store";
import { ON_DEVICE } from "@/lib/backend";
import { alertRules } from "@/lib/alerts/plan";
import { keyFor, providerInfo, resolveModel, resolveProvider } from "@/lib/insights/providers";
import { relativeTime } from "@/lib/format";
import { useUpdate } from "@/lib/use-update";

/**
 * Indice de ajustes.
 *
 * Antes todo vivia en una sola pantalla larga donde un boton, un selector y
 * un titulo de seccion se veian igual y costaba saber que era cada cosa. Ahora
 * cada tema es una pantalla aparte, como en los ajustes de un telefono, y este
 * indice dice de un vistazo como esta configurado cada uno: el resumen de la
 * derecha es lo que evita tener que entrar para averiguarlo.
 *
 * Cada seccion es una ruta y no un panel abierto por estado, asi el boton
 * fisico de atras de Android vuelve aca sin que haya que programarlo.
 */
export default function Ajustes() {
  const { accounts, assets, transactions, settings, portfolio } = useStore();

  const reglas = alertRules(settings);
  const provider = resolveProvider(settings.provider);
  const info = providerInfo(provider);
  const modeloId = resolveModel(provider, settings.model);
  const modelo = info.models.find((m) => m.id === modeloId)?.label ?? info.label;
  const clave = ON_DEVICE ? Boolean(keyFor(provider, settings)) : true;
  const update = useUpdate();

  const secciones = [
    {
      href: "/ajustes/cartera",
      titulo: "Cuentas y activos",
      detalle: "Dónde operás y qué tenés",
      estado: `${accounts.length} ${accounts.length === 1 ? "cuenta" : "cuentas"} · ${assets.length} ${assets.length === 1 ? "activo" : "activos"}`,
      alerta: portfolio.missingPrices.length > 0 ? `${portfolio.missingPrices.length} sin precio` : null,
    },
    {
      href: "/ajustes/perfil",
      titulo: "Tu perfil como inversor",
      detalle: "Riesgo, horizonte y objetivo",
      estado: `${settings.riskProfile} · ${settings.horizonYears} ${settings.horizonYears === 1 ? "año" : "años"}`,
      alerta: null,
    },
    {
      href: "/ajustes/insights",
      titulo: "Insights",
      detalle: "Proveedor, modelo y clave",
      estado: clave ? modelo : "sin clave",
      alerta: clave ? null : "falta la clave",
    },
    ...(ON_DEVICE
      ? [
          {
            href: "/ajustes/alertas",
            titulo: "Alertas de precio",
            detalle: "Avisos con la pantalla apagada",
            estado: reglas.enabled ? `activas · ${reglas.defaultPct}%` : "apagadas",
            alerta: null,
          },
        ]
      : []),
    {
      href: "/ajustes/datos",
      titulo: "Tus datos",
      detalle: "Backup, importación y borrar todo",
      estado: `${transactions.length} ${transactions.length === 1 ? "movimiento" : "movimientos"}`,
      alerta: null,
    },
    ...(ON_DEVICE
      ? [
          {
            href: "/ajustes/actualizar",
            titulo: "Actualizaciones",
            detalle: "Bajar la última versión de la app",
            estado: update.installed?.version ?? "—",
            alerta: update.available && update.release ? `nueva: ${update.release.version}` : null,
          },
        ]
      : []),
    {
      href: "/ajustes/diagnostico",
      titulo: "Diagnóstico",
      detalle: "Probar las fuentes de precios",
      estado: settings.lastQuoteSync ? relativeTime(settings.lastQuoteSync) : "sin datos",
      alerta: null,
    },
  ];

  return (
    <div className="pb-6">
      <Header title="Ajustes" />

      <ul className="card divide-hairline">
        {secciones.map((s) => (
          <li key={s.href}>
            <Link href={s.href} className="flex items-center gap-3 p-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium">{s.titulo}</span>
                <span className="label mt-0.5 block leading-snug">{s.detalle}</span>
              </span>
              <span className="shrink-0 text-right">
                <span
                  className="block text-[11px]"
                  style={{ color: s.alerta ? "var(--color-warn)" : "var(--color-ink-3)" }}
                >
                  {s.alerta ?? s.estado}
                </span>
              </span>
              <IconChevron size={13} className="shrink-0" />
            </Link>
          </li>
        ))}
      </ul>

      <p className="label mt-5 leading-relaxed">
        Waltra · {transactions.length} movimientos, {assets.length} activos.
        <br />
        Los precios son informativos y pueden tener demora. No es asesoramiento
        financiero.
      </p>
    </div>
  );
}
