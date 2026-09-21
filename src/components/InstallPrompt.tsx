"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Boton para instalar la app en la pantalla de inicio.
 *
 * Chrome en Android ofrece su propio cartel, pero aparece cuando quiere y es
 * facil perderselo. Guardamos el evento y damos un boton explicito en Ajustes,
 * que es donde alguien lo va a buscar.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    setStandalone(window.matchMedia("(display-mode: standalone)").matches);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (standalone || installed) {
    return (
      <p className="label leading-snug">
        Ya está instalada en este teléfono.
      </p>
    );
  }

  if (!deferred) {
    // Sin el evento (iOS, o Chrome que todavia no lo disparo) damos la
    // instruccion manual en vez de un boton que no haria nada.
    return (
      <p className="label leading-snug">
        Desde el menú del navegador: <strong>Agregar a la pantalla principal</strong>.
        Así abre a pantalla completa y anda sin conexión.
      </p>
    );
  }

  return (
    <>
      <button
        className="btn btn-sm w-full"
        onClick={async () => {
          await deferred.prompt();
          const choice = await deferred.userChoice;
          if (choice.outcome === "accepted") setInstalled(true);
          setDeferred(null);
        }}
      >
        Instalar en la pantalla de inicio
      </button>
      <p className="label mt-2 leading-snug">
        Abre a pantalla completa y funciona sin conexión. Tus datos ya están en este
        teléfono.
      </p>
    </>
  );
}
