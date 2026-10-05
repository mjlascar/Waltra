import { NATIVE } from "@/lib/platform";

/**
 * Vibracion al tocar.
 *
 * En el APK usa el motor de vibracion del telefono por el plugin de
 * Capacitor, que da el golpecito corto y seco de los teclados y no el zumbido
 * de una notificacion. En la web, `navigator.vibrate` donde existe (Chrome en
 * Android); en una compu no hace nada.
 *
 * El plugin se importa perezoso, como en `net/json`: el bundle web nunca lo
 * arrastra. Si falla, se calla: una vibracion que no sale no es un error que
 * haya que mostrarle a nadie.
 */
type Fuerza = "suave" | "media";

let plugin: Promise<typeof import("@capacitor/haptics") | null> | null = null;

function cargar() {
  plugin ??= import("@capacitor/haptics").catch(() => null);
  return plugin;
}

export function vibrar(fuerza: Fuerza = "suave"): void {
  if (NATIVE) {
    void cargar().then((m) => {
      if (!m) return;
      const style = fuerza === "media" ? m.ImpactStyle.Medium : m.ImpactStyle.Light;
      return m.Haptics.impact({ style }).catch(() => undefined);
    });
    return;
  }
  try {
    navigator.vibrate?.(fuerza === "media" ? 14 : 8);
  } catch {
    // Algunos navegadores tiran si la pagina no tuvo un gesto todavia.
  }
}
