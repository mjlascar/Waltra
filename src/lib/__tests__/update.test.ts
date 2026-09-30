import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APK_URL, isNewer, parseRelease, releaseBuild, updateErrorText } from "@/lib/update";

describe("la versión publicada", () => {
  it("sale del título que arma CI", () => {
    expect(releaseBuild({ name: "Waltra 1.0.52" })).toBe(52);
  });

  it("o de las notas, como estaban los releases viejos", () => {
    expect(
      releaseBuild({ name: "Waltra - ultima compilacion", body: "Version 1.0.47, de abc12345 en main." }),
    ).toBe(47);
  });

  // Lo que publica CI: el nombre con la v pegada en el título, la
  // compilación primera en las notas (ver ci.yml).
  const titulo = "Waltra v1.1.0";
  const notas =
    "Compilacion 1.0.56 de v1.1.0, de abc12345 en claude/investment-tracking-app-slxfyz.\n\nFirmado.";

  it("muestra el nombre de la versión y compara la compilación", () => {
    expect(parseRelease({ name: titulo, body: notas })).toMatchObject({ build: 56, version: "1.1.0" });
    expect(isNewer(parseRelease({ name: titulo, body: notas }), { build: 55, version: "1.1.55" })).toBe(true);
  });

  it("todas las apps ya instaladas leen la compilación correcta", () => {
    // Cada generación lee el release a su manera, y ya están en los
    // teléfonos: no se pueden cambiar, solo respetar.
    const generaciones = {
      // 1.0: busca "1.0.<n>" en el título y en las notas.
      "1.0": /\b1\.0\.(\d+)\b/,
      // 1.1.55: busca el primer "1.x.<n>" del título, y si no, el de las notas.
      "1.1.55": /\b1\.(\d+)\.(\d+)\b/,
    };
    for (const [gen, re] of Object.entries(generaciones)) {
      let build: number | null = null;
      for (const texto of [titulo, notas]) {
        const m = texto.match(re);
        if (m) {
          build = Number(m[m.length - 1]);
          break;
        }
      }
      expect(build, gen).toBe(56);
    }
  });

  it("CI publica con ese formato", () => {
    const ci = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
    expect(ci).toContain('--title "Waltra v${WALTRA_VERSION}"');
    expect(ci).toMatch(/notas=\$\(printf[^\n]*\n\s*"Compilacion 1\.0\.\$\{GITHUB_RUN_NUMBER\}/);
  });

  it("los releases de antes se siguen leyendo", () => {
    expect(parseRelease({ name: "Waltra 1.0.54" })).toMatchObject({ build: 54, version: "1.0.54" });
    expect(
      parseRelease({ name: "Waltra 1.1.55", body: "Version 1.1.55.\n\nCompilacion 1.0.55, para las versiones anteriores a la 1.1." }),
    ).toMatchObject({ build: 55, version: "1.1.55" });
  });

  it("sin número no inventa uno", () => {
    expect(releaseBuild({ name: "Waltra", body: "sin version" })).toBeNull();
    expect(parseRelease({ name: "Waltra" })).toBeNull();
  });

  it("usa el enlace del APK del release, o el de siempre", () => {
    const url = "https://github.com/x/y/releases/download/apk-latest/waltra.apk";
    expect(parseRelease({ name: "Waltra 1.0.3", assets: [{ name: "waltra.apk", browser_download_url: url }] }))
      .toMatchObject({ build: 3, version: "1.0.3", url });
    expect(parseRelease({ name: "Waltra 1.0.3", assets: [] })!.url).toBe(APK_URL);
  });
});

describe("isNewer", () => {
  const r = parseRelease({ name: "Waltra 1.0.50" });
  it("compara el número de compilación", () => {
    expect(isNewer(r, { build: 49, version: "1.0.49" })).toBe(true);
    expect(isNewer(r, { build: 50, version: "1.0.50" })).toBe(false);
    expect(isNewer(r, { build: 51, version: "1.0.51" })).toBe(false);
  });

  it("sin saber qué hay instalado, no ofrece nada", () => {
    expect(isNewer(r, null)).toBe(false);
    expect(isNewer(null, { build: 1, version: "1.0" })).toBe(false);
  });
});

describe("por qué no se pudo consultar", () => {
  it("un 404 es un release sin publicar, no la conexión", () => {
    expect(updateErrorText(new Error("HTTP 404"))).toMatch(/publicando/);
    expect(updateErrorText(new Error("HTTP 404"))).not.toMatch(/conexión/);
  });

  it("un 403 es el límite de GitHub", () => {
    expect(updateErrorText(new Error("HTTP 403"))).toMatch(/limita/);
  });

  it("sin respuesta, sí es la conexión", () => {
    expect(updateErrorText(new TypeError("Failed to fetch"))).toMatch(/conexión/);
    expect(updateErrorText(new Error("no respondió en 12 s"))).toMatch(/conexión/);
  });
});
