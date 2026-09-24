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
  /** "1.0.123", como lo muestra Android. */
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
 * El numero de version de un release. CI lo escribe como `1.0.<corrida>` en
 * el titulo y en las notas; se busca en los dos para no depender de uno solo.
 */
export function releaseBuild(release: { name?: string | null; body?: string | null }): number | null {
  for (const texto of [release.name, release.body]) {
    const m = typeof texto === "string" ? texto.match(/\b1\.0\.(\d+)\b/) : null;
    if (m) return Number(m[1]);
  }
  return null;
}

export function parseRelease(json: GithubRelease): ReleaseInfo | null {
  const build = releaseBuild(json);
  if (build === null) return null;
  const apk = json.assets?.find((a) => a.name === "waltra.apk")?.browser_download_url;
  return {
    build,
    version: `1.0.${build}`,
    url: apk ?? APK_URL,
    publishedAt: json.published_at ?? undefined,
  };
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
