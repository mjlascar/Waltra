import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getJson = vi.fn();
vi.mock("@/lib/net/json", () => ({ getJson: (...args: unknown[]) => getJson(...args) }));

const { APK_URL, RELEASE_API, VERSION_URL, latestRelease, parseVersionFile } = await import("@/lib/update");

const archivo = {
  build: 71, version: "1.2.0", size: 12832387, sha256: "AB".repeat(32),
  commit: "abc123", publishedAt: "2026-10-20T11:00:00Z",
};

beforeEach(() => getJson.mockReset());

describe("la version publicada sale de version.json", () => {
  it("lee lo que publica CI", () => {
    expect(parseVersionFile(archivo)).toEqual({
      build: 71, version: "1.2.0", url: APK_URL, size: 12832387,
      sha256: "ab".repeat(32), publishedAt: "2026-10-20T11:00:00Z",
    });
  });

  it("rechaza un archivo con otra forma en vez de inventar una version", () => {
    expect(parseVersionFile(null)).toBeNull();
    expect(parseVersionFile({ ...archivo, build: "71" })).toBeNull();
    expect(parseVersionFile({ ...archivo, version: "v1.2" })).toBeNull();
    expect(parseVersionFile({ ...archivo, sha256: "corta" })?.sha256).toBeUndefined();
  });

  it("no gasta la API de GitHub si el archivo esta", async () => {
    getJson.mockResolvedValueOnce(archivo);
    expect(await latestRelease()).toMatchObject({ build: 71, version: "1.2.0" });
    expect(getJson).toHaveBeenCalledTimes(1);
    expect(getJson.mock.calls[0][0]).toBe(VERSION_URL);
  });

  it("sin el archivo pregunta a la API, como antes", async () => {
    getJson.mockRejectedValueOnce(new Error("HTTP 404"));
    getJson.mockResolvedValueOnce({ name: "Waltra v1.1.5", body: "Compilacion 1.0.70 de v1.1.5, de abc12345 en main." });
    expect(await latestRelease()).toMatchObject({ build: 70, version: "1.1.5" });
    expect(getJson.mock.calls[1][0]).toBe(RELEASE_API);
  });

  it("CI publica version.json con los campos que lee la app", () => {
    const ci = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
    expect(ci).toContain("gh release create apk-latest waltra.apk version.json");
    for (const campo of ["build", "version", "size", "sha256", "publishedAt"]) {
      expect(ci).toMatch(new RegExp(`${campo}: \\$${campo}`));
    }
    expect(VERSION_URL.endsWith("/releases/download/apk-latest/version.json")).toBe(true);
  });
});
