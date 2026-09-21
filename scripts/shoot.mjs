/**
 * Saca capturas de la app en un viewport de Samsung S10e (360 x 760).
 * Uso: node scripts/shoot.mjs [etiqueta]
 */
import { chromium } from "playwright";
import { MOBILE, chromiumPath } from "./browser.mjs";
import { mkdirSync } from "node:fs";

const label = process.argv[2] ?? "app";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const OUT = "screenshots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: chromiumPath(),
  args: ["--no-sandbox"],
});
const context = await browser.newContext(MOBILE);
const page = await context.newPage();

const logs = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") logs.push(`[${m.type()}] ${m.text()}`);
});
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

async function shot(name, { full = true } = {}) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${label}-${name}.png`, fullPage: full });
  console.log(`· ${OUT}/${label}-${name}.png`);
}

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

// Si es la primera vez, cargamos los datos de ejemplo.
const demo = page.getByRole("button", { name: /datos de ejemplo/i });
if (await demo.count()) {
  await shot("00-vacio");
  await demo.click();
  await page.waitForTimeout(4000);
}

await shot("01-resumen");

for (const [path, name] of [
  ["/cartera", "02-cartera"],
  ["/movimientos", "03-movimientos"],
  ["/insights", "04-insights"],
  ["/ajustes", "05-ajustes"],
]) {
  const res = await page.goto(BASE + path, { waitUntil: "networkidle" }).catch(() => null);
  if (res && res.status() < 400) await shot(name);
  else console.log(`· ${path} -> ${res ? res.status() : "sin respuesta"}`);
}

// Hoja de carga rapida.
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
const add = page.getByRole("button", { name: /agregar movimiento/i });
if (await add.count()) {
  await add.click();
  await page.waitForTimeout(400);
  await page.keyboard.type("compré 50 de QQQ a 480");
  await page.waitForTimeout(500);
  await shot("06-carga", { full: false });
}

if (logs.length) {
  console.log("\n--- consola ---");
  for (const l of [...new Set(logs)].slice(0, 25)) console.log(l);
}

await browser.close();
