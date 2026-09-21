/**
 * Resuelve con que Chromium lanzar Playwright.
 *
 * En algunos entornos (contenedores con navegadores preinstalados) la version
 * de Playwright no coincide con la build que hay en disco. Antes de fallar,
 * buscamos cualquier Chromium razonable en PLAYWRIGHT_BROWSERS_PATH.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root && existsSync(root)) {
    const candidates = readdirSync(root)
      .filter((name) => name.startsWith("chromium-"))
      .sort()
      .reverse()
      .map((name) => join(root, name, "chrome-linux", "chrome"))
      .filter(existsSync);
    if (candidates.length) return candidates[0];
  }
  // Sin candidato, Playwright usa el navegador que descargo por su cuenta.
  return undefined;
}

export const MOBILE = {
  // Samsung Galaxy S10e: el telefono donde se va a usar esto.
  viewport: { width: 360, height: 760 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: "es-AR",
  timezoneId: "America/Argentina/Buenos_Aires",
};
