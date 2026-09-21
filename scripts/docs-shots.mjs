/**
 * Capturas para el README, a escala 1: se muestran a 220 px de ancho, sacarlas
 * al doble solo engorda el repositorio.
 */
import { chromium } from "playwright";
import { MOBILE, chromiumPath } from "./browser.mjs";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
mkdirSync("docs/img", { recursive: true });

const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"] });
const page = await (
  await browser.newContext({ ...MOBILE, deviceScaleFactor: 1 })
).newPage();

/**
 * Solo el viewport: es literalmente lo que ve alguien con el telefono en la
 * mano. Una captura de pagina completa dejaria la barra de navegacion, que es
 * fija, flotando en el medio de la imagen.
 */
async function shot(name, { scroll = 0 } = {}) {
  if (scroll) await page.evaluate((y) => window.scrollTo(0, y), scroll);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `docs/img/${name}.png` });
  console.log(`· docs/img/${name}.png`);
}

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const demo = page.getByRole("button", { name: /datos de ejemplo/i });
if (await demo.count()) {
  await demo.click();
  await page.waitForTimeout(4500);
}

await shot("resumen");

await page.getByRole("button", { name: /^Rendimiento$/ }).click();
await shot("rendimiento");
await page.getByRole("button", { name: /^Valor$/ }).click();

await page.goto(`${BASE}/cartera`, { waitUntil: "networkidle" });
await shot("cartera");

await page.goto(`${BASE}/movimientos`, { waitUntil: "networkidle" });
await shot("movimientos");

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.getByRole("button", { name: /agregar movimiento/i }).click();
await page.waitForTimeout(400);
await page.locator('input[placeholder*="QQQ"]').first().fill("compré 50 de QQQ a 480");
await shot("carga");
await page.keyboard.press("Escape");

await page.goto(`${BASE}/ajustes`, { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await page.getByRole("button", { name: /Pegar movimientos desde tus notas/ }).click();
await page.waitForTimeout(400);
await page.locator('[role="dialog"] textarea').first().fill(
  [
    "# lo que tenia anotado",
    "12/03/2025 pasé 500 dólares a cocos",
    "13/03/2025 compré 300 de QQQ a 430",
    "20/04/2025 pasé 200 a binance",
    "21/04/2025 compré 0,002 BTC a 84000",
    "che acordate de revisar esto",
  ].join("\n"),
);
await page.waitForTimeout(900);
await shot("importar");

await browser.close();
