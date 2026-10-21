/**
 * Capturas para el README, a escala 1: se muestran a 220 px de ancho, sacarlas
 * al doble solo engorda el repositorio.
 *
 * Necesita la app con `WALTRA_MOCK=1`: precios simulados, el Binance de prueba
 * y la lectura de capturas de prueba. La de Insights la saca
 * `scripts/insights-preview.mjs`, que inyecta un informe de muestra.
 */
import { chromium } from "playwright";
import { MOBILE, chromiumPath } from "./browser.mjs";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
mkdirSync("docs/img", { recursive: true });

const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"] });
const context = await browser.newContext({ ...MOBILE, deviceScaleFactor: 1 });
let page = await context.newPage();

/**
 * Solo el viewport: es literalmente lo que ve alguien con el telefono en la
 * mano. Una captura de pagina completa dejaria la barra de navegacion, que es
 * fija, flotando en el medio de la imagen.
 */
async function shot(name, { scroll = 0 } = {}) {
  if (scroll) await page.evaluate((y) => window.scrollTo(0, y), scroll);
  await page.waitForTimeout(700);
  // Que no salga el "actualizando…" de arriba: se espera a que terminen los precios.
  await page
    .waitForFunction(() => !document.body.innerText.toLowerCase().includes("actualizando…"), null, { timeout: 15_000 })
    .catch(() => {});
  await page.screenshot({ path: `docs/img/${name}.png` });
  console.log(`· docs/img/${name}.png`);
}

async function abrirMas() {
  await page.getByRole("button", { name: /agregar movimiento/i }).click();
  await page.waitForTimeout(500);
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

// La carga escribiendo la frase: el + pregunta primero qué hiciste.
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await abrirMas();
await page.getByRole("button", { name: /escribirlo en una línea/i }).click();
await page.waitForTimeout(400);
await page.locator('input[placeholder*="QQQ"]').first().fill("compré 9 SPY por 456345 pesos en cocos");
await shot("carga");
await page.keyboard.press("Escape");

await page.goto(`${BASE}/ajustes/datos`, { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await page.getByRole("button", { name: /Pegar movimientos desde tus notas/ }).click();
await page.waitForTimeout(400);
await page.locator('[role="dialog"] textarea').first().fill(
  [
    "# lo que tenia anotado",
    "12/03/2025 pasé 500 dólares a cocos",
    "13/03/2025 compré 10 QQQ por 240 usd",
    "20/04/2025 pasé 200 a binance",
    "21/04/2025 compré 0,002 BTC a 84000",
    "che acordate de revisar esto",
  ].join("\n"),
);
await page.waitForTimeout(900);
await shot("importar");
await page.keyboard.press("Escape");

// Desde capturas: una captura inventada de una lista de actividad, sin marca
// de ningun broker. El servidor de prueba no la mira: contesta una lectura fija.
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await abrirMas();
await page.getByRole("button", { name: /desde capturas/i }).click();
await page.waitForTimeout(500);
const captura = await page.evaluate(() => {
  const c = document.createElement("canvas");
  c.width = 540;
  c.height = 1140;
  const x = c.getContext("2d");
  x.fillStyle = "#f4f5f7";
  x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = "#111";
  x.font = "bold 34px sans-serif";
  x.fillText("Actividad", 32, 80);
  const filas = [
    ["13 oct", "Compra SPY", "9 · $ 456.345"],
    ["14 oct", "Compra de dólares", "US$ 100"],
    ["15 oct", "Compra AL30", "1.000 · $ 82.610"],
  ];
  filas.forEach(([dia, que, cuanto], i) => {
    const y = 150 + i * 130;
    x.fillStyle = "#fff";
    x.fillRect(24, y, c.width - 48, 110);
    x.fillStyle = "#666";
    x.font = "22px sans-serif";
    x.fillText(dia, 44, y + 40);
    x.fillStyle = "#111";
    x.font = "26px sans-serif";
    x.fillText(que, 44, y + 80);
    x.fillText(cuanto, 300, y + 80);
  });
  return c.toDataURL("image/png").split(",")[1];
});
await page.setInputFiles('[role="dialog"] input[type="file"]', {
  name: "actividad.png",
  mimeType: "image/png",
  buffer: Buffer.from(captura, "base64"),
});
await page.waitForTimeout(400);
await page.getByRole("button", { name: /^Leer 1 captura con/ }).click();
await page.waitForTimeout(5000);
// Que se vea lo que se leyo y la revision, no solo los botones.
await page.evaluate(() => {
  const destino = [...document.querySelectorAll('[role="dialog"] *')].find(
    (el) => el.children.length === 0 && el.textContent?.trim().toLowerCase() === "lo que se leyó",
  );
  destino?.scrollIntoView({ block: "start" });
});
await shot("capturas");
await page.keyboard.press("Escape");

// Binance conectada, en un contexto aparte: sus movimientos de prueba no se
// mezclan con la cartera de ejemplo de las otras capturas. La clave es la de
// prueba de `emptyFake()` en src/lib/binance/fake.ts.
const limpio = await browser.newContext({ ...MOBILE, deviceScaleFactor: 1 });
page = await limpio.newPage();
await page.goto(`${BASE}/ajustes/binance`, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
const claves = page.locator('input[type="password"]');
await claves.nth(0).fill("clave-de-prueba-0000000000000000000000000000");
await claves.nth(1).fill("secreto-de-prueba-000000000000000000000000000");
await page.getByRole("button", { name: /^Conectar$/ }).click();
await page.waitForTimeout(7000);
await page.goto(`${BASE}/movimientos`, { waitUntil: "networkidle" });
await shot("binance");

await browser.close();
