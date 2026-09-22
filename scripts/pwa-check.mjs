/**
 * Verifica la promesa de PWA contra un build de produccion: manifest, iconos,
 * service worker y, sobre todo, que la app siga abriendo sin conexion.
 *
 * Uso: BASE_URL=http://127.0.0.1:3100 node scripts/pwa-check.mjs
 */
import { chromium } from "playwright";
import { MOBILE, chromiumPath } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
let passed = 0;
const fallas = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    fallas.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FALLA ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"] });
const context = await browser.newContext(MOBILE);
const page = await context.newPage();

console.log("\n1. Recursos de instalación");
for (const [path, tipo] of [
  ["/manifest.webmanifest", "application/manifest+json"],
  ["/icon-192.png", "image/png"],
  ["/icon-512.png", "image/png"],
  ["/icon-maskable-512.png", "image/png"],
  ["/apple-touch-icon.png", "image/png"],
  ["/sw.js", "javascript"],
]) {
  const res = await page.request.get(BASE + path);
  check(`${path} se sirve`, res.status() === 200, `HTTP ${res.status()}`);
  if (res.status() === 200 && tipo === "image/png") {
    const body = await res.body();
    // Firma PNG: si no está, lo que se sirve no es una imagen.
    check(`${path} es un PNG válido`, body[0] === 0x89 && body.toString("latin1", 1, 4) === "PNG");
  }
}

const manifest = await (await page.request.get(`${BASE}/manifest.webmanifest`)).json();
check("el manifest declara modo standalone", manifest.display === "standalone", manifest.display);
check("el manifest tiene un ícono maskable", manifest.icons.some((i) => i.purpose === "maskable"));
check("el color de fondo es el de la app", manifest.background_color === "#0a0a0b", manifest.background_color);

console.log("\n2. Service worker");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const demo = page.getByRole("button", { name: /datos de ejemplo/i });
if (await demo.count()) {
  await demo.click();
  await page.waitForTimeout(4000);
}
const registrado = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return Boolean(reg?.active || reg?.installing || reg?.waiting);
});
check("el service worker queda registrado", registrado);

// Esperamos a que tome el control antes de cortar la red.
await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForTimeout(1500);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);

console.log("\n3. Sin conexión");
await context.setOffline(true);
await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
await page.waitForTimeout(3000);
const offline = (await page.evaluate(() => document.body.innerText)).replace(/ /g, " ");
check("la app abre sin conexión", /valor total/i.test(offline), offline.slice(0, 160));
check("los datos siguen ahí", /US\$/.test(offline), offline.slice(0, 160));

// Y se puede seguir cargando movimientos sin red.
await page.getByRole("button", { name: /agregar movimiento/i }).click();
await page.waitForTimeout(500);
await page.getByRole("button", { name: /escribirlo en una línea/i }).click();
await page.waitForTimeout(400);
await page.locator('input[placeholder*="QQQ"]').first().fill("pasé 50 dólares a cocos");
await page.waitForTimeout(800);
await page.getByRole("button", { name: /^Agregar$/ }).click();
await page.waitForTimeout(2500);
const despues = (await page.evaluate(() => document.body.innerText)).replace(/ /g, " ");
check("se pueden cargar movimientos sin red", /valor total/i.test(despues), despues.slice(0, 160));

await context.setOffline(false);
await browser.close();

console.log(`\n${passed} ok, ${fallas.length} fallas`);
if (fallas.length) {
  for (const f of fallas) console.log(`  · ${f}`);
  process.exit(1);
}
