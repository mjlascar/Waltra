/**
 * Verifica el build del APK sin necesitar un telefono.
 *
 * Sirve la exportacion estatica que va a viajar adentro del APK y la abre en
 * un navegador con el viewport del S10e. No prueba los plugins nativos (para
 * eso hace falta Android de verdad), pero si todo lo demas: que la app arranca
 * sin servidor, que las pantallas del modo telefono aparecen, que las que son
 * del modo servidor no, y que no hay un solo error de consola.
 *
 * Uso:
 *   npm run build:native
 *   node scripts/native-check.mjs
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { MOBILE, chromiumPath } from "./browser.mjs";

const RAIZ = "out";
const PUERTO = Number(process.env.PORT ?? 4173);

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Un servidor de archivos igual de tonto que el del WebView: resuelve
 * directorios a su index.html y no sabe nada de rutas dinamicas. Si la app
 * necesitara un servidor de verdad, esto fallaria, que es justamente el punto.
 */
const server = createServer(async (req, res) => {
  const ruta = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const seguro = normalize(ruta).replace(/^(\.\.[/\\])+/, "");
  let archivo = join(RAIZ, seguro);
  try {
    const info = await stat(archivo).catch(() => null);
    if (!info || info.isDirectory()) archivo = join(archivo, "index.html");
    const cuerpo = await readFile(archivo);
    res.writeHead(200, { "Content-Type": TIPOS[extname(archivo)] ?? "application/octet-stream" });
    res.end(cuerpo);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("no encontrado");
  }
});

await new Promise((resolve) => server.listen(PUERTO, "127.0.0.1", resolve));
const BASE = `http://127.0.0.1:${PUERTO}`;

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

const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"] });
const context = await browser.newContext(MOBILE);
const page = await context.newPage();

const pedidos = [];
page.on("request", (r) => pedidos.push(r.url()));
page.on("console", (m) => {
  const text = m.text();
  if (m.type() !== "error") return;
  // Sin servidor y sin puente nativo, los precios no se pueden traer: eso es
  // esperable aca y no en el telefono.
  if (/favicon|icon-192|Download the React|Failed to load resource|CORS|net::ERR/i.test(text)) return;
  consoleErrors.push(text);
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

const text = () => page.evaluate(() => document.body.innerText);
const normalizar = (s) => s.replace(/ /g, " ").toLowerCase();
const has = async (needle) => normalizar(await text()).includes(normalizar(needle));

async function goto(path) {
  await page.goto(BASE + path, { waitUntil: "load" });
  await page.waitForTimeout(600);
}

console.log("\n1. Arranca sin servidor");
await goto("/");
await page.waitForTimeout(1200);
check("la pantalla inicial se dibuja", await has("Waltra"));
check("hidrató: el botón de ejemplo responde", (await page.getByRole("button").count()) > 0);

console.log("\n2. Navegación entre pantallas, servidas como archivos");
// Con la base vacia, Cartera y Movimientos muestran la pantalla de arranque y
// no su contenido: hay que cargar algo para que la marca que se busca sea de
// la pagina y no de la barra de abajo, que ya no lleva rotulos.
const ejemploNav = page.getByRole("button", { name: /datos de ejemplo/i });
if (await ejemploNav.count()) {
  await ejemploNav.click();
  await page.waitForTimeout(2500);
}
for (const [ruta, marca] of [
  ["/cartera", "Invertido"],
  ["/movimientos", "Todas las cuentas"],
  ["/insights", "Insights"],
  ["/ajustes", "Cuentas y activos"],
]) {
  await goto(ruta);
  check(`${ruta} abre directo`, await has(marca), (await text()).slice(0, 160));
}

console.log("\n3. Lo que corresponde al modo teléfono");
await goto("/ajustes");
check("es un índice de secciones", await has("Cuentas y activos"));
check("ofrece las alertas de precio", await has("Alertas de precio"));

await goto("/ajustes/insights");
check("pide la clave del proveedor elegido", await has("Tu clave de Claude"));
check("no habla de la clave del servidor", !(await has("WALTRA_ACCESS_KEY")));
check("deja elegir proveedor", (await page.getByRole("button", { name: /^Gemini$/ }).count()) === 1);
await page.getByRole("button", { name: /^Gemini$/ }).click();
await page.waitForTimeout(500);
check("al cambiar de proveedor cambia la clave que pide", await has("Tu clave de Gemini"));
check("y cambian los modelos", await has("Gemini Pro"));
await page.getByRole("button", { name: /^Claude$/ }).click();
await page.waitForTimeout(400);
check("se puede volver", await has("Tu clave de Claude"));

console.log("\n4. Las alertas se pueden configurar");
await goto("/ajustes/alertas");
await page.getByRole("button", { name: /activar alertas/i }).click();
await page.waitForTimeout(600);
check("aparecen los umbrales por activo", await has("Avisarme si un activo se mueve"));
check("aparece el umbral de la cartera", await has("la cartera entera se mueve"));
check("aparece el resumen diario", await has("Resumen diario"));
check("aparece la franja sin molestar", await has("No molestar"));
check("advierte sobre las suspensiones de Samsung", await has("Apps en suspensión"));
check("deja probar una notificación", (await page.getByRole("button", { name: /probar una notificación/i }).count()) === 1);

console.log("\n4b. El informe externo, para usar un abono sin API");
await goto("/insights");
check("ofrece el camino sin clave de API", await has("Sin clave de API"));
await page.getByRole("button", { name: /copiar el pedido y pegar/i }).click();
await page.waitForTimeout(600);
// El pedido vive en el `value` de un textarea, que `innerText` no ve.
const pedidoTexto = await page.locator("textarea[readonly]").first().inputValue();
check("arma el pedido completo", /## Cartera/.test(pedidoTexto) && /marketBrief/.test(pedidoTexto), pedidoTexto.slice(0, 120));
check("el pedido lleva las posiciones reales", /QQQ/.test(pedidoTexto));
check("deja elegir el tipo de informe", (await page.getByRole("button", { name: /^Mercado$/ }).count()) === 1);
check("aclara qué se comparte", await has("No lleva los montos"));
await page.locator('[aria-label="Cerrar"]').first().click();
await page.waitForTimeout(400);

console.log("\n4c. El historial de Binance se importa sin servidor");
// La lectura del CSV es del navegador: si algun dia se moviera a /api, esto
// fallaria en el APK y en ningun otro lado.
await goto("/ajustes/datos");
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
      "2026-02-11 12:00:00,9004,ETHUSDT,Limit,BUY,2000,1ETH,2026-02-11 12:00:00,0ETH,0,0USDT,CANCELED",
    ].join("\n"),
    "utf8",
  ),
});
await page.waitForTimeout(800);
check("lee el archivo en el teléfono", await has("2 órdenes ejecutadas"), (await text()).slice(0, 300));
check("avisa que faltan los ingresos", await has("no los ingresos ni los retiros"));
await page.locator('[aria-label="Cerrar"]').first().click();
await page.waitForTimeout(400);

console.log("\n5. No hay servidor propio en el medio");
// La prueba no es "no sale nada a internet": con datos cargados la app SI
// consulta a los proveedores, y que lo haga directo es justamente el punto
// del modo nativo. Lo que no puede existir es una llamada a un servidor de
// Waltra, porque adentro del APK no hay ninguno.
const aNuestroApi = pedidos.filter((u) => u.startsWith(`${BASE}/api/`));
check("ninguna llamada a un /api propio", aNuestroApi.length === 0, aNuestroApi.slice(0, 3).join(", "));
const aProveedores = pedidos.filter(
  (u) => u.includes("binance.com") || u.includes("finance.yahoo.com") || u.includes("data912.com"),
);
check("los precios se piden directo al proveedor", aProveedores.length > 0, `${aProveedores.length} pedidos`);

console.log("\n6. Consola limpia");
check("sin errores de consola", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();
server.close();

console.log(`\n${passed} ok, ${failures.length} fallas\n`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
