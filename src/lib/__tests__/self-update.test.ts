import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installerMessage, installUpdate } from "@/lib/self-update";
import { APK_URL, RELEASE_DOWNLOADS, installable, parseRelease } from "@/lib/update";

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");
const notas = "Compilacion 1.0.70 de v1.2.0, de abc12345 en claude/investment-tracking-app-slxfyz.";

describe("la app se actualiza sola", () => {
  it("lee del release el tamaño y la huella del APK para verificarlo al bajarlo", () => {
    const release = parseRelease({
      name: "Waltra v1.2.0", body: notas,
      assets: [{ name: "waltra.apk", browser_download_url: APK_URL, size: 11189938, digest: `sha256:${"AB".repeat(32)}` }],
    });
    expect(release).toMatchObject({ build: 70, size: 11189938, sha256: "ab".repeat(32) });
    // Una huella con otro formato no se usa: mejor sin verificar que verificar contra basura.
    const rara = parseRelease({ name: "Waltra v1.2.0", body: notas, assets: [{ name: "waltra.apk", digest: "md5:abc" }] });
    expect(rara?.sha256).toBeUndefined();
  });

  it("solo se instala lo que viene del release de Waltra", () => {
    expect(installable(APK_URL)).toBe(true);
    expect(installable("https://github.com/otro/Waltra/releases/download/apk-latest/waltra.apk")).toBe(false);
    expect(installable("http://github.com/mjlascar/Waltra/releases/download/apk-latest/waltra.apk")).toBe(false);
    expect(installable(`${RELEASE_DOWNLOADS}../../../otro/repo/releases/download/x/waltra.apk`)).toBe(false);
    expect(installable("https://example.com/waltra.apk")).toBe(false);
  });

  it("una direccion ajena se rechaza antes de llegar al plugin nativo", async () => {
    const release = { build: 70, version: "1.2.0", url: "https://example.com/waltra.apk" };
    await expect(installUpdate(release, () => {}, () => {})).rejects.toThrow(/no es la de las versiones/);
  });

  it("el plugin nativo acepta el mismo prefijo que la app", () => {
    // Si se separan, o la app ofrece algo que el plugin rechaza, o el plugin
    // acepta algo que la app no controla.
    const java = leer("android/app/src/main/java/app/waltra/SelfUpdatePlugin.java");
    expect(java.match(/ALLOWED = "([^"]+)"/)?.[1]).toBe(RELEASE_DOWNLOADS);
    expect(java).toContain('url.contains("..")');
  });

  it("el manifiesto pide los permisos y no expone el receptor del instalador", () => {
    const manifest = leer("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain('android.permission.REQUEST_INSTALL_PACKAGES');
    // Sin este, desde Android 12 igual se pide confirmar cada actualizacion.
    expect(manifest).toContain('android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION');
    // Exportado, otra app podria mandarle "falta confirmar" con cualquier
    // actividad adentro, y el receptor la abriria.
    expect(manifest).toMatch(/android:name="\.SelfUpdateReceiver"\s+android:exported="false"/);
    expect(manifest).toMatch(/\.UpdatedReceiver"[\s\S]*?MY_PACKAGE_REPLACED/);
  });

  it("el plugin se registra antes de que arranque el puente", () => {
    const activity = leer("android/app/src/main/java/app/waltra/MainActivity.java");
    const registro = activity.indexOf("registerPlugin(SelfUpdatePlugin.class)");
    expect(registro).toBeGreaterThan(-1);
    expect(registro).toBeLessThan(activity.indexOf("super.onCreate(savedInstanceState)"));
  });

  it("explica en palabras por que el instalador la rechazo", () => {
    expect(installerMessage(5, "")).toMatch(/otra clave/);
    expect(installerMessage(6, "")).toMatch(/espacio/);
    expect(installerMessage(1, "INSTALL_FAILED_X")).toContain("INSTALL_FAILED_X");
  });
});
