"use client";

import { AjustesShell } from "@/components/ajustes/Shell";
import { AlertSettings } from "@/components/AlertSettings";
import { Notice } from "@/components/ui/Notice";
import { ON_DEVICE } from "@/lib/backend";

/** Avisos de precio con la pantalla apagada. Solo existen adentro del APK. */
export default function AlertasAjustes() {
  return (
    <AjustesShell
      title="Alertas de precio"
      intro="Waltra mira los precios en segundo plano y te avisa cuando algo se mueve más de lo que pediste."
    >
      {ON_DEVICE ? (
        <AlertSettings />
      ) : (
        <Notice>
          Las alertas necesitan que la app esté instalada como APK: en el navegador no
          hay forma de mirar los precios con la pantalla apagada.
        </Notice>
      )}
    </AjustesShell>
  );
}
