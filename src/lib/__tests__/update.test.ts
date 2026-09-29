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

  it("la 1.1 se lee igual, y el número que cuenta es la compilación", () => {
    expect(parseRelease({ name: "Waltra 1.1.55" })).toMatchObject({ build: 55, version: "1.1.55" });
    const r = parseRelease({ name: "Waltra 1.1.55" });
    expect(isNewer(r, { build: 54, version: "1.0.54" })).toBe(true);
  });

  it("las notas le hablan también a las apps de antes de la 1.1", () => {
    // Una app 1.0 solo reconoce "1.0.<n>": si las notas no lo traen, nunca
    // se entera de que salió la 1.1. Es la línea que agrega CI.
    const body = "Version 1.1.55, de abc.\n\nCompilacion 1.0.55, para las versiones anteriores a la 1.1.";
    expect(body.match(/\b1\.0\.(\d+)\b/)?.[1]).toBe("55");
    expect(releaseBuild({ name: "Waltra 1.1.55", body })).toBe(55);
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
