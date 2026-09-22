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

// Importación de un bloc de notas.
await page.goto(`${BASE}/ajustes/datos`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
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
    "15/06/2025 vendí 0,3 QQQ a 470",
  ].join("\n"),
);
await page.waitForTimeout(900);
await shot("importar", true);
await page.keyboard.press("Escape");

// Importación del historial de Binance.
await page.goto(`${BASE}/ajustes/datos`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.getByRole("button", { name: /Importar el historial de Binance/ }).click();
await page.waitForTimeout(400);
await page.locator('[data-testid="binance-file"]').setInputFiles({
  name: "Binance-Spot-Order-History.csv",
  mimeType: "text/csv",
  buffer: Buffer.from(
    [
      "\ufeffTime,OrderNo,Pair,Type\u00b9,Side,Order Price,Order Amount,Time,Executed\u00b2,Average Price,Trading total\u00b3,Status",
      "2026-01-05 10:00:00,9001,BTCUSDT,Market,BUY,0,0.002BTC,2026-01-05 10:00:00,0.002BTC,90000,180USDT,FILLED",
      "2026-01-20 11:30:00,9002,ETHUSDT,Limit,BUY,3000,0.05ETH,2026-01-22 09:15:00,0.05ETH,3000,150USDT,FILLED",
      "2026-02-10 12:00:00,9003,BTCUSDT,Market,SELL,0,0.001BTC,2026-02-10 12:00:00,0.001BTC,95000,95USDT,FILLED",
      "2026-02-11 12:00:00,9004,ETHUSDT,Limit,BUY,2000,1ETH,2026-02-11 12:00:00,0ETH,0,0USDT,CANCELED",
      "2026-02-12 12:00:00,9005,SOLETH,Market,BUY,0,1SOL,2026-02-12 12:00:00,1SOL,0.055,0.055ETH,FILLED",
    ].join("\n"),
    "utf8",
  ),
});
await page.waitForTimeout(900);
await shot("binance", true);
await page.keyboard.press("Escape");

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
// El primer paso pregunta que hizo; el texto libre esta un toque mas abajo.
await shot("carga-tipo");
await page.getByRole("button", { name: /escribirlo en una línea/i }).click();
await page.waitForTimeout(400);
await page.locator('input[placeholder*="QQQ"]').first().fill("le metí unos mangos al bitcoin");
await shot("carga-dudosa");
await page.keyboard.press("Escape");

// El recorrido guiado, con el paso de datos abierto.
await page.waitForTimeout(400);
await page.getByRole("button", { name: /agregar movimiento/i }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: /^Compré/ }).first().click();
await page.waitForTimeout(400);
await shot("carga-datos", true);
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
