"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { NATIVE } from "@/lib/platform";

/**
 * Los detalles de vivir adentro de un APK.
 *
 * Nada de esto existe en la web, y con NATIVE en falso el empaquetador borra
 * el cuerpo entero. Son tres cosas que, si faltan, hacen que la app se sienta
 * una pagina metida a la fuerza en un telefono:
 *
 * 1. La barra de estado tiene que ser del color de la app, con texto claro.
 * 2. El splash se saca cuando React ya dibujo, no antes.
 * 3. El boton fisico de atras tiene que volver, y salir solo desde el inicio.
 */
export function NativeShell() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!NATIVE) return;
    let alive = true;

    void (async () => {
      const [{ StatusBar, Style }, { SplashScreen }] = await Promise.all([
        import("@capacitor/status-bar"),
        import("@capacitor/splash-screen"),
      ]);
      if (!alive) return;
      // `Dark` en el plugin significa texto claro sobre fondo oscuro.
      await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      await StatusBar.setBackgroundColor({ color: "#0a0a0b" }).catch(() => {});
      // Que el sistema reserve el alto de la barra de estado en vez de
      // dibujarla encima del contenido. Sin esto, el titulo de cada pantalla
      // queda debajo del reloj y de los iconos de notificacion.
      await StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
      await SplashScreen.hide().catch(() => {});
    })();

    return () => {
      alive = false;
    };
  }, []);

  // El boton de atras se registra aparte porque depende de la ruta actual.
  useEffect(() => {
    if (!NATIVE) return;
    let remove: (() => void) | undefined;

    void (async () => {
      const { App } = await import("@capacitor/app");
      const handle = await App.addListener("backButton", ({ canGoBack }) => {
        // En el inicio, atras cierra la app: seguir navegando hacia atras
        // dentro de una pantalla sola es exactamente lo que nadie espera.
        if (pathname === "/" || !canGoBack) void App.exitApp();
        else router.back();
      });
      remove = () => void handle.remove();
    })();

    return () => remove?.();
  }, [pathname, router]);

  return null;
}
