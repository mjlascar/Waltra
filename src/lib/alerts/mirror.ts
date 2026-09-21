import { NATIVE } from "@/lib/platform";
import { ALERT_PLAN_KEY, ALERT_STATE_KEY, type AlertPlan } from "@/lib/alerts/plan";

/**
 * El puente entre la app y el vigia de precios.
 *
 * El vigia corre en otro proceso y no puede abrir IndexedDB, asi que la app le
 * deja el plan en las preferencias compartidas de Android.
 *
 * ATENCION, que esto es fragil y no salta solo: el plugin del vigia abre el
 * archivo de preferencias cuyo nombre es su `label`
 * (`context.getSharedPreferences(label, MODE_PRIVATE)`), y el plugin de
 * preferencias abre el que diga su `group`. Para que se vean, los dos tienen
 * que coincidir. Si alguien cambia el label en capacitor.config.ts y no
 * cambia esto, las alertas dejan de salir sin un solo error en ningun lado.
 */
export const KV_GROUP = "app.waltra.alertas";

let configurado = false;

/**
 * Los plugins de Capacitor son proxies que convierten cualquier acceso a una
 * propiedad en una llamada al puente nativo. Incluido `.then`: si se devuelve
 * el plugin desde una funcion `async`, el motor lo toma por una promesa,
 * llama a `then()` y revienta con "Preferences.then() is not implemented".
 *
 * Por eso vuelve envuelto en un objeto comun.
 */
async function prefs() {
  const { Preferences } = await import("@capacitor/preferences");
  if (!configurado) {
    await Preferences.configure({ group: KV_GROUP });
    configurado = true;
  }
  return { Preferences };
}

/** Deja el plan donde el vigia lo busca. `null` lo apaga. */
export async function writeAlertPlan(plan: AlertPlan | null): Promise<void> {
  if (!NATIVE) return;
  const { Preferences } = await prefs();
  if (!plan) {
    await Preferences.remove({ key: ALERT_PLAN_KEY });
    // El estado se borra junto con el plan: si las alertas se vuelven a
    // prender, no tiene sentido arrastrar lo que ya se aviso hace semanas.
    await Preferences.remove({ key: ALERT_STATE_KEY });
    return;
  }
  await Preferences.set({ key: ALERT_PLAN_KEY, value: JSON.stringify(plan) });
}

/** Permiso para notificar. En Android 12 y anteriores viene concedido. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!NATIVE) return false;
  try {
    const { BackgroundRunner } = await import("@capacitor/background-runner");
    const status = await BackgroundRunner.requestPermissions({ apis: ["notifications"] });
    return status.notifications === "granted";
  } catch {
    return false;
  }
}

export async function notificationPermission(): Promise<boolean> {
  if (!NATIVE) return false;
  try {
    const { BackgroundRunner } = await import("@capacitor/background-runner");
    const status = await BackgroundRunner.checkPermissions();
    return status.notifications === "granted";
  } catch {
    return false;
  }
}

/**
 * Una notificacion de prueba, disparada a mano desde Ajustes.
 *
 * Existe porque el resto de la cadena es invisible hasta que se rompe: entre
 * el permiso, el canal, el icono y las optimizaciones de bateria de Samsung
 * hay cuatro formas de que no llegue nada. Esto separa "no llega ninguna
 * notificacion" de "el vigia no se esta ejecutando".
 */
export async function sendTestNotification(): Promise<void> {
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  await LocalNotifications.schedule({
    notifications: [
      {
        id: 424242,
        title: "Waltra",
        body: "Las notificaciones llegan bien. Las alertas de precio van a salir así.",
        schedule: { at: new Date(Date.now() + 1500) },
      },
    ],
  });
}
