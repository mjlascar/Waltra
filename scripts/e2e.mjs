/**
 * Recorrido end-to-end sobre un navegador real, en viewport de S10e.
 *
 * No reemplaza a los tests unitarios del motor: cubre lo que aquellos no ven,
 * que es si la app se puede usar de verdad (guardar, editar, borrar, navegar,
 * exportar) sin romperse por el camino.
 *
 * Uso: node scripts/e2e.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const EXEC = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let passed = 0;
const failures = [];
const consoleErrors = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FALLA ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const context = await browser.newContext({
  viewport: { width: 360, height: 760 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: "es-AR",
  timezoneId: "America/Argentina/Buenos_Aires",
});
const page = await context.newPage();
page.on("console", (m) => {
  const text = m.text();
  if (m.type() !== "error") return;
  if (/hmr|WebSocket|favicon|icon-192|Download the React/i.test(text)) return;
  consoleErrors.push(text);
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

const text = () => page.evaluate(() => document.body.innerText);
// innerText devuelve el texto ya transformado (los rotulos van en mayusculas
// por CSS) y los montos llevan espacio duro: normalizamos las dos cosas.
const normalize = (s) => s.replace(/\u00a0/g, " ").toLowerCase();
const has = async (needle) => normalize(await text()).includes(normalize(needle));

async function goto(path) {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
}

console.log("\n1. Arranque y datos de ejemplo");
await goto("/");
await page.waitForTimeout(1200);
check("muestra la pantalla inicial", await has("Waltra"));
await page.getByRole("button", { name: /datos de ejemplo/i }).click();
await page.waitForTimeout(4500);
check("carga la cartera de ejemplo", await has("Valor total"));
check("el capital aportado no es cero", !(await has("Capital aportado\nUS$ 0,00")));

console.log("\n2. Carga rápida en lenguaje natural");
await page.getByRole("button", { name: /agregar movimiento/i }).click();
await page.waitForTimeout(500);
await page.locator('input[placeholder*="QQQ"]').first().fill("compré 25 dólares de SOL a 200 en binance");
await page.waitForTimeout(900);
const preview = await text();
check("interpreta el tipo", preview.includes("Compra"), preview.slice(0, 200));
check("interpreta el activo", preview.includes("SOL"));
check("interpreta la cuenta", preview.includes("Binance"));
check("deriva la cantidad", preview.includes("0,125"));
await page.getByRole("button", { name: /^Agregar$/ }).click();
await page.waitForTimeout(2500);

await goto("/movimientos");
check("el movimiento aparece en la lista", await has("SOL"));

console.log("\n3. La posición nueva llega a la cartera");
await goto("/cartera");
check("la posición figura en la cartera", await has("SOL"));

console.log("\n4. Detalle, edición y borrado");
await goto("/movimientos");
await page.getByRole("button", { name: /SOL/ }).first().click();
await page.waitForTimeout(600);
check("abre el detalle", await has("Precio unitario"));
check("guarda la frase original", await has("compré 25 dólares de SOL"));
await page.getByRole("button", { name: /Editar/ }).click();
await page.waitForTimeout(700);
const notaInput = page.locator('input[placeholder="Opcional"]').first();
await notaInput.fill("probando la edición");
await page.getByRole("button", { name: /Guardar cambios/ }).click();
await page.waitForTimeout(1500);
check("la nota editada se guarda", await has("probando la edición"));

await page.getByRole("button", { name: /SOL/ }).first().click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: /Borrar/ }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: /Sí, borrar/ }).click();
await page.waitForTimeout(1500);
check("el movimiento se borra", !(await has("probando la edición")));

console.log("\n5. Navegación entre vistas");
for (const [path, marker] of [
  ["/", "Valor total"],
  ["/cartera", "Invertido"],
  ["/movimientos", "movimientos"],
  ["/insights", "Insights"],
  ["/ajustes", "Tu perfil como inversor"],
]) {
  await goto(path);
  check(`${path} renderiza`, await has(marker));
}

console.log("\n6. Filtros de movimientos");
await goto("/movimientos");
const totalCount = Number(normalize(await text()).match(/(\d+) movimientos/)?.[1] ?? 0);
check("cuenta los movimientos", totalCount > 0, `contó ${totalCount}`);
await page.getByRole("button", { name: /^CAPITAL$/i }).click();
await page.waitForTimeout(500);
const capitalCount = Number(normalize(await text()).match(/(\d+) movimientos/)?.[1] ?? 0);
check("el filtro de capital reduce la lista", capitalCount > 0 && capitalCount < totalCount,
  `${capitalCount} de ${totalCount}`);
await page.locator('input[placeholder*="Buscar"]').fill("btc");
await page.waitForTimeout(500);
check("la búsqueda filtra", (await has("0 movimientos")) || !(await has("ingreso")));

console.log("\n7. Rangos del gráfico");
await goto("/");
for (const label of ["1M", "3M", "1A", "Todo"]) {
  await page.getByRole("button", { name: new RegExp(`^${label}$`) }).click();
  await page.waitForTimeout(400);
}
check("los rangos no rompen el gráfico", (await page.locator("svg path").count()) > 0);

console.log("\n8. Cruceta del gráfico");
const svg = page.locator("svg").nth(2);
const box = await svg.boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  await page.waitForTimeout(400);
  check("la cruceta muestra el capital del día", await has("capital"));
  await page.mouse.up();
} else {
  check("la cruceta muestra el capital del día", false, "no encontré el gráfico");
}

console.log("\n9. Ajustes: perfil y activos");
await goto("/ajustes");
await page.getByRole("button", { name: /^Agresivo$/ }).click();
await page.waitForTimeout(700);
await goto("/ajustes");
const agresivo = await page.getByRole("button", { name: /^Agresivo$/ }).getAttribute("data-active");
check("el perfil persiste tras recargar", agresivo === "true", `data-active=${agresivo}`);

await page.getByRole("button", { name: /BTC/ }).first().click();
await page.waitForTimeout(600);
check("abre el editor de activo", await has("Símbolo en la fuente"));
await page.getByRole("button", { name: /Cerrar/ }).first().click();
await page.waitForTimeout(400);

console.log("\n10. Backup");
const download = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
await page.getByRole("button", { name: /^Exportar$/ }).click();
const file = await download;
check("exporta un backup", Boolean(file), file ? await file.suggestedFilename() : "sin descarga");

console.log("\n11. Persistencia entre sesiones");
await goto("/");
const before = normalize(await text()).match(/us\$ ([\d.,]+)/)?.[1];
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const after = normalize(await text()).match(/us\$ ([\d.,]+)/)?.[1];
check("el valor sobrevive a la recarga", Boolean(before) && before === after, `${before} vs ${after}`);

console.log("\n12. Consola limpia");
check("sin errores de consola", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();

console.log(`\n${passed} ok, ${failures.length} fallas`);
if (failures.length) {
  console.log("\nFallas:");
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
