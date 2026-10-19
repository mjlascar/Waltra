import type { PluginListenerHandle } from "@capacitor/core";
import { NATIVE } from "@/lib/platform";
import { installable, type ReleaseInfo } from "@/lib/update";

/**
 * La app se instala su propia version nueva, sin navegador.
 *
 * Lo hace `SelfUpdatePlugin.java`: baja el APK del release, verifica tamaño y
 * huella, y se lo pasa al instalador de Android. Desde Android 12 no se pide
 * confirmar cada vez; antes, o si el telefono igual lo pide, aparece el dialogo
 * del sistema. La primera vez hace falta el permiso de instalar apps, que da el
 * usuario en una pantalla del sistema.
 *
 * Al terminar, Android cierra la app para reemplazarla, y una notificacion
 * avisa que ya esta (`UpdatedReceiver.java`).
 */

interface SelfUpdateNative {
  status(): Promise<{ allowed: boolean; silent: boolean }>;
  openSettings(): Promise<void>;
  install(options: { url: string; sha256?: string }): Promise<void>;
  addListener(event: "progress", fn: (p: { done: number; total: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: "failed", fn: (p: { status: number; message: string }) => void): Promise<PluginListenerHandle>;
}

/**
 * Envuelto en un objeto: los plugins de Capacitor son proxies que contestan
 * cualquier propiedad, `.then` incluido, y devolver uno desde una funcion
 * async hace que se lo tome por una promesa (ver CLAUDE.md).
 */
let cached: { plugin: SelfUpdateNative } | null = null;
async function bridge(): Promise<{ plugin: SelfUpdateNative }> {
  if (!cached) {
    const { registerPlugin } = await import("@capacitor/core");
    cached = { plugin: registerPlugin<SelfUpdateNative>("SelfUpdate") };
  }
  return cached;
}

export interface InstallStatus {
  /** Ya tiene el permiso de instalar apps. */
  allowed: boolean;
  /** Android 12 o mas: se instala sin pedir confirmacion. */
  silent: boolean;
}

/** Null en la web, o si el plugin no esta (no deberia pasar en el APK). */
export async function installStatus(): Promise<InstallStatus | null> {
  if (!NATIVE) return null;
  try {
    const { plugin } = await bridge();
    return await plugin.status();
  } catch {
    return null;
  }
}

/** Abre la pantalla del sistema donde se le da a Waltra el permiso de instalar apps. */
export async function openInstallSettings(): Promise<void> {
  const { plugin } = await bridge();
  await plugin.openSettings();
}

/**
 * Baja e instala la version publicada. Resuelve cuando el APK ya esta en
 * manos del instalador: lo que sigue es que Android cierre la app. Si despues
 * el instalador la rechaza, avisa `onFailed`.
 */
export async function installUpdate(
  release: ReleaseInfo,
  onProgress: (done: number, total: number) => void,
  onFailed: (message: string) => void,
): Promise<void> {
  if (!installable(release.url)) throw new Error("Esa dirección no es la de las versiones de Waltra.");
  const { plugin } = await bridge();
  const progress = await plugin.addListener("progress", (p) => onProgress(p.done, p.total > 0 ? p.total : release.size ?? 0));
  const failed = await plugin.addListener("failed", (p) => onFailed(installerMessage(p.status, p.message)));
  try {
    await plugin.install({ url: release.url, ...(release.sha256 ? { sha256: release.sha256 } : {}) });
  } catch (err) {
    await failed.remove();
    throw err;
  } finally {
    await progress.remove();
  }
}

/**
 * Lo que contesta el instalador, en palabras. Los codigos son los de
 * `PackageInstaller.STATUS_*`.
 */
export function installerMessage(status: number, message: string): string {
  switch (status) {
    case 2: // STATUS_FAILURE_BLOCKED
      return "El teléfono bloqueó la instalación.";
    case 3: // STATUS_FAILURE_ABORTED
      return "Se canceló la instalación.";
    case 4: // STATUS_FAILURE_INVALID
      return "El archivo bajado no es una versión válida de Waltra.";
    case 5: // STATUS_FAILURE_CONFLICT
      return "Android no deja instalarla encima de esta: está firmada con otra clave o es más vieja.";
    case 6: // STATUS_FAILURE_STORAGE
      return "No hay espacio suficiente en el teléfono.";
    case 7: // STATUS_FAILURE_INCOMPATIBLE
      return "Esta versión no es compatible con el teléfono.";
    default:
      return message ? `Android no pudo instalarla: ${message}` : "Android no pudo instalarla.";
  }
}
