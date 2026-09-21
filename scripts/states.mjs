/** Captura estados puntuales de la interfaz para revisarlos de a uno. */
import { chromium } from "playwright";
import { MOBILE, chromiumPath } from "./browser.mjs";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const label = process.argv[2] ?? "st";
mkdirSync("screenshots", { recursive: true });

const browser = await chromium.launch({
  executablePath: chromiumPath(),
  args: ["--no-sandbox"],
});
const page = await (
  await browser.newContext(MOBILE)
).newPage();

async function shot(name, full = false) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `screenshots/${label}-${name}.png`, fullPage: full });
  console.log(`· screenshots/${label}-${name}.png`);
}

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
const demo = page.getByRole("button", { name: /datos de ejemplo/i });
if (await demo.count()) {
  await demo.click();
  await page.waitForTimeout(4500);
}

// Detalle de una posición.
await page.goto(`${BASE}/cartera`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.locator("button").filter({ hasText: "QQQ" }).first().click();
await shot("posicion");
await page.keyboard.press("Escape");

// Detalle de un movimiento.
await page.goto(`${BASE}/movimientos`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.locator("button").filter({ hasText: "COMPRA" }).first().click();
await shot("movimiento");
await page.keyboard.press("Escape");

// Carga rápida con una frase que el parser local no entiende bien.
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.getByRole("button", { name: /agregar movimiento/i }).click();
await page.waitForTimeout(400);
await page.locator('input[placeholder*="QQQ"]').first().fill("le metí unos mangos al bitcoin");
await shot("carga-dudosa");

// Formulario completo.
await page.getByRole("button", { name: /^Formulario$/ }).click();
await page.waitForTimeout(400);
await shot("formulario");
await page.keyboard.press("Escape");

// Cartera agrupada por cuenta.
await page.goto(`${BASE}/cartera`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.getByRole("button", { name: /Por cuenta/ }).click();
await shot("cartera-cuentas", true);

// Modo rendimiento, con el índice de referencia superpuesto.
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(3500);
await page.getByRole("button", { name: /^Rendimiento$/ }).click();
await page.waitForTimeout(800);
await shot("rendimiento");

// Rango corto del gráfico.
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.getByRole("button", { name: /^3M$/ }).click();
await shot("rango-3m");

await browser.close();
