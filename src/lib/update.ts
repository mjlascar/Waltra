import { NATIVE } from "@/lib/platform";
import { getJson } from "@/lib/net/json";

/**
 * Actualizaciones del APK.
 *
 * La app no esta en Play, asi que nadie le avisa al telefono que hay una
 * version nueva: cada push publica el APK en el release `apk-latest` y habia
 * que entrar a GitHub a mirar. Aca la app se fija sola, contra el mismo
 * release, y ofrece bajar el APK con un toque. El vigia de
 * `public/runners/alerts.js` hace lo mismo con la pantalla apagada y manda
 * una notificacion; lee el numero de version con su propia copia de
 * `releaseBuild`, y hay un test que compara las dos.
 *
 * La instalacion la hace Android: el APK se baja con el navegador y el
 * sistema pide confirmar. Instalar desde adentro de la app pediria un permiso
 * mas y codigo nativo propio, para ahorrarse un toque.
 */

/** El repositorio es publico: la version se consulta sin credenciales. */
export const REPO = "mjlascar/Waltra";
export const RELEASE_API = `https://api.github.com/repos/${REPO}/releases/tags/apk-latest`;
/** El enlace de siempre. El release se rehace en cada push, el enlace no cambia. */
export const APK_URL = `https://github.com/${REPO}/releases/download/apk-latest/waltra.apk`;

export interface ReleaseInfo {
  /** El `versionCode` del APK publicado: el numero de corrida de CI. */
  build: number;
  /** "1.1.0", como lo muestra Android. */
  version: string;
  url: string;
  publishedAt?: string;
}

interface GithubRelease {
  name?: string | null;
  body?: string | null;
  published_at?: string | null;
  assets?: { name?: string; browser_download_url?: string }[];
}

/**
 * El numero de compilacion de un release: la corrida de CI, que crece siempre
 * y es lo que se compara. Viaja en las notas como `1.0.<corrida>`, porque es
 * lo unico que reconocen todas las apps ya instaladas:
 *
 * - las 1.0 buscan `1.0.<n>` en el titulo y en las notas;
 * - las 1.1.<corrida> buscan el primer `1.x.<n>` del titulo, y si no hay, el
 *   de las notas.
 *
 * Por eso el titulo lleva el nombre como `v1.1.0`: con la `v` pegada no lo
 * toma ninguna de las dos (sin ella, una 1.1.55 leeria "compilacion 0" y no
 * se enteraria nunca mas de una version nueva). Y en las notas la linea de la
 * compilacion va primero. El vigia tiene una copia de esta funcion, y el test
 * las compara.
 */
export function releaseBuild(release: { name?: string | null; body?: string | null }): number | null {
  for (const texto of [release.name, release.body]) {
    const m = typeof texto === "string" ? texto.match(/\b1\.0\.(\d+)\b/) : null;
    if (m) return Number(m[1]);
  }
  return null;
}

/** El nombre de la version, "1.1.0", del titulo. Sin el, el de la compilacion. */
function releaseName(release: { name?: string | null }, build: number): string {
  const titulo = release.name ?? "";
  const nuevo = titulo.match(/\bv(\d+\.\d+\.\d+)\b/);
  if (nuevo) return nuevo[1];
  // Los releases de antes: "Waltra 1.1.55" o "Waltra 1.0.54".
  const viejo = titulo.match(/\b(1\.\d+\.\d+)\b/);
  return viejo ? viejo[1] : `1.0.${build}`;
}

export function parseRelease(json: GithubRelease): ReleaseInfo | null {
  const build = releaseBuild(json);
  if (build === null) return null;
  const apk = json.assets?.find((a) => a.name === "waltra.apk")?.browser_download_url;
  return {
    build,
    version: releaseName(json, build),
    url: apk ?? APK_URL,
    publishedAt: json.published_at ?? undefined,
  };
}

/**
 * Por que no se pudo consultar, en palabras. Un 404 no es falta de señal: es
 * que el release no esta publicado (CI lo esta rehaciendo, o quedo en
 * borrador), y decir "revisá la conexión" mandaba a buscar el problema donde
 * no estaba. Un 403 es el limite de GitHub: 60 consultas por hora por red.
 */
export function updateErrorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const status = Number(msg.match(/HTTP (\d{3})/)?.[1] ?? 0);
  if (status === 404) {
    return "GitHub no tiene publicada ninguna versión en este momento. Suele ser que se está publicando una nueva: probá en unos minutos";
  }
  if (status === 403 || status === 429) {
    return "GitHub limita las consultas por hora desde una misma red. Probá de nuevo en un rato";
  }
  if (status >= 500) return "GitHub está con problemas. Probá de nuevo en un rato";
  return "GitHub no respondió, revisá la conexión y probá de nuevo";
}

/** Lo publicado. Lanza si GitHub no contesta: quien llama decide que decir. */
export async function latestRelease(): Promise<ReleaseInfo | null> {
  const json = await getJson<GithubRelease>(RELEASE_API, {
    headers: { Accept: "application/vnd.github+json" },
  });
  return parseRelease(json);
}

export interface InstalledApp {
  build: number;
  version: string;
}

/** Lo instalado, segun Android. En la web no hay nada que actualizar. */
export async function installedApp(): Promise<InstalledApp | null> {
  if (!NATIVE) return null;
  try {
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    const build = Number(info.build);
    return Number.isFinite(build) && build > 0 ? { build, version: info.version } : null;
  } catch {
    return null;
  }
}

export function isNewer(release: ReleaseInfo | null, installed: InstalledApp | null): boolean {
  return Boolean(release && installed && release.build > installed.build);
}
