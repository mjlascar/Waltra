import { describe, expect, it } from "vitest";
import { APK_URL, isNewer, parseRelease, releaseBuild } from "@/lib/update";

describe("la versión publicada", () => {
  it("sale del título que arma CI", () => {
    expect(releaseBuild({ name: "Waltra 1.0.52" })).toBe(52);
  });

  it("o de las notas, como estaban los releases viejos", () => {
    expect(
      releaseBuild({ name: "Waltra - ultima compilacion", body: "Version 1.0.47, de abc12345 en main." }),
    ).toBe(47);
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
