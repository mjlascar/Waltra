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
import { MOBILE, chromiumPath } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";

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
// Las metricas siguen la ventana del grafico, y el default es un mes: el
// capital de toda la historia esta en «Todo».
await page.getByRole("button", { name: /^Todo$/ }).click();
await page.waitForTimeout(600);
check("el capital aportado no es cero", !(await has("Capital aportado\nUS$ 0,00")));

/** Abre la hoja y va al campo de texto libre. */
async function abrirEscritura() {
  await page.getByRole("button", { name: /agregar movimiento/i }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /escribirlo en una línea/i }).click();
  await page.waitForTimeout(400);
}

/** Cierra la hoja desde la X, que sirve en cualquier paso. */
async function cerrarHoja() {
  await page.locator('[aria-label="Cerrar"]').first().click();
  await page.waitForTimeout(400);
}

console.log("\n2. Carga rápida en lenguaje natural");
await abrirEscritura();
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

console.log("\n2b. «Vendí todo» completa la tenencia real");
await goto("/");
await abrirEscritura();
await page.locator('input[placeholder*="QQQ"]').first().fill("vendí todo el QQQ");
await page.waitForTimeout(900);
const vendeTodo = await text();
check("lee la venta total", await has("Venta"), vendeTodo.slice(0, 160));
// La cartera de ejemplo tiene 2,95 unidades de QQQ.
check("completa la cantidad desde la posición", /2,95|2\.95/.test(vendeTodo), vendeTodo.slice(0, 200));
check("no reclama un monto que puede deducir", !(await has("No encontré ningún monto")));
await cerrarHoja();

console.log("\n2c. Avisos de datos");
await goto("/");
await abrirEscritura();
await page.locator('input[placeholder*="QQQ"]').first().fill("vendí 999 QQQ a 500");
await page.waitForTimeout(900);
check("avisa si vendés más de lo que tenés", await has("estás vendiendo"), (await text()).slice(0, 250));
await page.locator('input[placeholder*="QQQ"]').first().fill("compré 100 de XYZNOEXISTE a 10");
await page.waitForTimeout(700);
check("no avisa de más en una compra normal", !(await has("estás vendiendo")));
await cerrarHoja();

console.log("\n2d. El recorrido guiado, sin escribir una palabra");
await goto("/");
await page.getByRole("button", { name: /agregar movimiento/i }).click();
await page.waitForTimeout(400);
check("pregunta primero qué hiciste", await has("¿Qué hiciste?"));
check("ofrece los cuatro movimientos frecuentes", await has("Ingresé dinero"));
check("los menos frecuentes no compiten", await has("Menos frecuentes"));
await page.getByRole("button", { name: /^Compré Acciones/ }).click();
await page.waitForTimeout(500);
check("pasa al paso de datos", await has("Activo"));
check("ofrece lo que ya tenés en cartera", (await page.getByRole("button", { name: /^QQQ$/ }).count()) > 0);
await page.getByRole("button", { name: /^QQQ$/ }).first().click();
await page.waitForTimeout(300);
await page.locator('input[placeholder="50"]').first().fill("200");
await page.locator('input[placeholder="480"]').first().fill("500");
await page.waitForTimeout(500);
check("deriva las unidades del monto", await has("0,4"), (await text()).slice(0, 300));
check("los detalles finos quedan guardados", await has("Comisión, tipo de cambio y nota"));
await page.getByRole("button", { name: /^Agregar$/ }).click();
await page.waitForTimeout(2200);
await goto("/movimientos");
check("la compra guiada quedó cargada", await has("QQQ"));

console.log("\n2e. Comprar más de lo que hay en la cuenta");
// La cuenta cierra igual (el efectivo va a negativo y cancela el activo de
// mas), pero describe algo que no pudo pasar y hay que decirlo.
await goto("/");
await abrirEscritura();
await page.locator('input[placeholder*="QQQ"]').first().fill("compré 99000 dólares de QQQ en cocos");
await page.waitForTimeout(1000);
const descubierto = await text();
check(
  "avisa que no alcanza el efectivo",
  /falta cargar el ingreso/i.test(descubierto),
  descubierto.slice(0, 400),
);
await page.locator('input[placeholder*="QQQ"]').first().fill("compré 20 dólares de QQQ en cocos");
await page.waitForTimeout(900);
check("no avisa cuando el efectivo alcanza", !/falta cargar el ingreso/i.test(await text()));
await cerrarHoja();

console.log("\n2f. En pesos, una acción de EE.UU. es su CEDEAR");
// El bug real: 9 CEDEARs de SPY comprados en pesos quedaron como 9 acciones
// de US$ 660 y la cartera salto US$ 6.000.
await goto("/");
await abrirEscritura();
await page.locator('input[placeholder*="QQQ"]').first().fill("compré 9 SPY a 50705 pesos en cocos");
await page.waitForTimeout(1000);
check("avisa que va como CEDEAR", await has("se carga como su CEDEAR (SPY.BA)"), (await text()).slice(0, 400));
await page.getByRole("button", { name: /^Agregar$/ }).click();
await page.waitForTimeout(2500);
await goto("/cartera");
check("la compra en pesos queda en el CEDEAR", await has("SPY.BA"));

// Y lo que ya estaba mal cargado antes de la regla: un backup con una accion
// de EE.UU. comprada en pesos, como el que quedo en el telefono.
const roto = {
  app: "waltra",
  version: 1,
  exportedAt: "2026-09-24T00:00:00.000Z",
  accounts: [],
  assets: [
    { id: "aapl-roto", symbol: "AAPL", name: "Apple", kind: "stock", currency: "USD", source: "yahoo", sourceSymbol: "AAPL", precision: 6 },
  ],
  transactions: [
    {
      id: "aapl-roto-compra",
      date: "2026-09-01",
      type: "buy",
      accountId: "cocos",
      assetId: "aapl-roto",
      quantity: 10,
      price: 20000,
      amount: 200000,
      currency: "ARS",
      createdAt: "2026-09-01T12:00:00.000Z",
      updatedAt: "2026-09-01T12:00:00.000Z",
    },
  ],
};
await goto("/ajustes/datos");
await page.locator('input[type="file"][accept*="json"]').setInputFiles({
  name: "backup-roto.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify(roto), "utf8"),
});
await page.waitForTimeout(1500);
await goto("/");
await page.waitForTimeout(800);
check("detecta la acción comprada en pesos", await has("AAPL está cargado como la acción de EE.UU."), (await text()).slice(0, 500));
await page.getByRole("button", { name: /Corregir: pasar a CEDEAR/ }).click();
await page.waitForTimeout(2500);
check("el aviso se va después de corregir", !(await has("AAPL está cargado como la acción de EE.UU.")));
await goto("/cartera");
check("queda como CEDEAR en la cartera", await has("AAPL.BA"));

console.log("\n2g. Cargar con el total del comprobante y las unidades");
await goto("/");
await page.getByRole("button", { name: /agregar movimiento/i }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: /^Compré Acciones/ }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: /^QQQ$/ }).first().click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: /^Total y unid\.$/ }).click();
await page.waitForTimeout(200);
await page.locator('input[placeholder="456.345"]').fill("1000");
await page.locator('input[placeholder="9"]').fill("2");
await page.waitForTimeout(400);
check("deduce el precio por unidad", await has("Precio por unidad: US$ 500,00"), (await text()).slice(0, 500));
await cerrarHoja();

console.log("\n2h. Comprar dólares en la cuenta");
await goto("/");
await page.getByRole("button", { name: /agregar movimiento/i }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: /Compré o vendí dólares/ }).click();
await page.waitForTimeout(400);
await page.locator('input[placeholder="145.000"]').fill("145000");
await page.locator('input[placeholder="100"]').first().fill("100");
await page.waitForTimeout(400);
check("muestra el dólar que resulta", await has("Dólar a $ 1.450"), (await text()).slice(0, 500));
check("aclara que no es capital", await has("No es capital ni ganancia"));
await page.getByRole("button", { name: /^Agregar$/ }).click();
await page.waitForTimeout(2000);
await goto("/movimientos");
check("queda como compra de dólares", await has("Compra de dólares"));
check("a la derecha lo que entró", await has("US$ 100"));

// Y escrito en una línea, como se diría.
await goto("/");
await abrirEscritura();
await page.locator('input[placeholder*="QQQ"]').first().fill("compré 50 dólares a 1400 en cocos");
await page.waitForTimeout(900);
check("la frase suelta también lo entiende", await has("Cambio de moneda"), (await text()).slice(0, 400));
await cerrarHoja();

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
await page.getByRole("button", { name: /Comisión, tipo de cambio y nota/ }).click();
await page.waitForTimeout(300);
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

console.log("\n4b. Importar un bloc de notas entero");
await goto("/ajustes/datos");
await page.getByRole("button", { name: /Pegar movimientos desde tus notas/ }).click();
await page.waitForTimeout(500);
const notas = [
  "# mis notas",
  "05/01/2026 pasé 400 dólares a cocos",
  "06/01/2026 compré 200 de SOL a 190",
  "esto no es un movimiento",
  "10/02/2026 vendí 0,2 SOL a 210",
].join("\n");
await page.locator('[role="dialog"] textarea').first().fill(notas);
await page.waitForTimeout(900);
const bulk = await text();
check("cuenta las líneas listas", /3 de 4 listas/i.test(bulk), bulk.slice(0, 300));
check("marca la línea que no entiende", await has("Sin monto"), bulk.slice(0, 400));
await page.getByRole("button", { name: /^Agregar 3$/ }).click();
await page.waitForTimeout(3000);
check("confirma cuántos cargó", await has("Se cargaron 3"), (await text()).slice(0, 200));
await page.getByRole("button", { name: /^Listo$/ }).click();
await page.waitForTimeout(600);

await goto("/movimientos");
check("los movimientos importados aparecen", await has("SOL"));
await goto("/cartera");
check("la posición importada llega a la cartera", await has("SOL"));

console.log("\n4c. Importar el historial de Binance");
// Filas inventadas con el formato exacto de la exportacion: marca de orden de
// bytes, dos columnas "Time" y el simbolo pegado al numero.
const binanceCsv = [
  "\ufeffTime,OrderNo,Pair,Type\u00b9,Side,Order Price,Order Amount,Time,Executed\u00b2,Average Price,Trading total\u00b3,Status",
  "2026-01-05 10:00:00,9001,BTCUSDT,Market,BUY,0,0.002BTC,2026-01-05 10:00:00,0.002BTC,90000,180USDT,FILLED",
  "2026-01-20 11:30:00,9002,ETHUSDT,Limit,BUY,3000,0.05ETH,2026-01-22 09:15:00,0.05ETH,3000,150USDT,FILLED",
  "2026-02-10 12:00:00,9003,BTCUSDT,Market,SELL,0,0.001BTC,2026-02-10 12:00:00,0.001BTC,95000,95USDT,FILLED",
  "2026-02-11 12:00:00,9004,ETHUSDT,Limit,BUY,2000,1ETH,2026-02-11 12:00:00,0ETH,0,0USDT,CANCELED",
].join("\n");
await goto("/ajustes/datos");
await page.getByRole("button", { name: /Importar el historial de Binance/ }).click();
await page.waitForTimeout(400);
await page.locator('[data-testid="binance-file"]').setInputFiles({
  name: "Binance-Spot-Order-History.csv",
  mimeType: "text/csv",
  buffer: Buffer.from(binanceCsv, "utf8"),
});
await page.waitForTimeout(900);
const bnc = await text();
check("cuenta las órdenes ejecutadas", /3 órdenes ejecutadas/i.test(bnc), bnc.slice(0, 400));
check("no cuenta la cancelada", /1 sin ejecutar/i.test(bnc), bnc.slice(0, 400));
check("avisa que no vienen los ingresos", await has("no los ingresos ni los retiros"));
check("propone el capital que consumieron las órdenes", await has("US$ 235,00"), bnc.slice(0, 600));
await page.getByRole("button", { name: /^Importar 3$/ }).click();
await page.waitForTimeout(3000);
// Tres ordenes mas el ingreso de capital.
check("carga las órdenes y el capital", await has("Se cargaron 4"), (await text()).slice(0, 200));
await page.getByRole("button", { name: /^Listo$/ }).click();
await page.waitForTimeout(600);

await goto("/movimientos");
check("las órdenes de Binance aparecen", await has("Binance ETH/USDT"));
check("el capital entró como ingreso, no como ganancia", await has("Capital estimado"));
await goto("/cartera");
// El BTC ya existia en la cartera de ejemplo: la importacion tiene que sumar
// a esa posicion, no abrir una segunda con el mismo simbolo.
const btcRows = await page.evaluate(
  () =>
    [...document.querySelectorAll("section button span")].filter(
      (el) => el.textContent.trim() === "BTC",
    ).length,
);
check("reusa el activo que ya existía", btcRows === 1, `filas BTC: ${btcRows}`);

console.log("\n5. Navegación entre vistas");
for (const [path, marker] of [
  ["/", "Valor total"],
  ["/cartera", "Invertido"],
  ["/movimientos", "movimientos"],
  ["/insights", "Insights"],
  ["/ajustes", "Cuentas y activos"],
]) {
  await goto(path);
  check(`${path} renderiza`, await has(marker));
}

console.log("\n5b. Explicación de las métricas");
await goto("/");
await page.getByRole("button", { name: /¿Cómo se calcula\?/ }).click();
await page.waitForTimeout(700);
const explica = await text();
check("explica el capital aportado", await has("no es capital nuevo"), explica.slice(0, 200));
check("explica el rendimiento real", await has("neutralizando las entradas y salidas"));
check("usa los números de la cartera", /\d+ días/.test(explica));
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

console.log("\n5c. Detalle de cuenta y reconciliación de saldo");
await goto("/");
await page.locator("button").filter({ hasText: "Cocos Capital" }).first().click();
await page.waitForTimeout(700);
check("abre el detalle de la cuenta", await has("Ajustar el efectivo"), (await text()).slice(0, 200));
const antes = normalize(await text()).match(/según waltra\s*us\$ ([\d.,]+)/);
check("muestra el efectivo que conoce la app", Boolean(antes), antes?.[0]);
await page.locator('[role="dialog"] input[inputmode="decimal"]').first().fill("999");
await page.waitForTimeout(500);
check("calcula la diferencia", await has("Diferencia"), (await text()).slice(0, 300));
await page.getByRole("button", { name: /Registrar el ajuste/ }).click();
await page.waitForTimeout(1500);
check("confirma el ajuste", await has("El saldo ya coincide"), (await text()).slice(0, 200));
await page.keyboard.press("Escape");
await page.waitForTimeout(600);

await goto("/movimientos");
check("el ajuste queda anotado como tal", await has("ajuste de saldo"), (await text()).slice(0, 400));

console.log("\n6. Filtros de movimientos");
await goto("/movimientos");
const totalCount = Number(normalize(await text()).match(/(\d+) movimientos/)?.[1] ?? 0);
check("cuenta los movimientos", totalCount > 0, `contó ${totalCount}`);
await page.getByRole("button", { name: /^CAPITAL$/i }).click();
await page.waitForTimeout(500);
const capitalCount = Number(normalize(await text()).match(/(\d+) movimientos/)?.[1] ?? 0);
check("el filtro de capital reduce la lista", capitalCount > 0 && capitalCount < totalCount,
  `${capitalCount} de ${totalCount}`);
// Con pocos movimientos no tiene que aparecer el boton de paginado.
check("sin paginado cuando la lista es corta", !(await has("Mostrar")), `${totalCount} movimientos`);
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

/** La ganancia que muestra el bloque de métricas, tal cual se lee. */
async function gananciaVisible() {
  return page.evaluate(() => {
    const celdas = [...document.querySelectorAll("button .eyebrow")];
    const celda = celdas.find((e) => e.textContent.trim().toLowerCase() === "ganancia");
    return celda?.nextElementSibling?.textContent?.trim() ?? "";
  });
}

// Antes, cambiar de ventana movia el grafico y dejaba las cuatro metricas
// quietas: la ganancia del mes era la de siempre.
await page.getByRole("button", { name: /^Todo$/ }).click();
await page.waitForTimeout(500);
check("las métricas dicen de qué período hablan", await has("Cómo te fue desde el primer movimiento"));
const totalGan = await gananciaVisible();
await page.getByRole("button", { name: /^7D$/ }).click();
await page.waitForTimeout(600);
check("el rótulo sigue la ventana elegida", await has("Cómo te fue en los últimos 7 días"), (await text()).slice(0, 300));
const semanaGan = await gananciaVisible();
check("la ganancia cambia con la ventana", semanaGan !== totalGan, `todo: ${totalGan} · 7d: ${semanaGan}`);
check("no anualiza una semana", await has("hace falta un período más largo"));
await page.getByRole("button", { name: /^Todo$/ }).click();
await page.waitForTimeout(500);
check("volver a «Todo» devuelve el número de siempre", (await gananciaVisible()) === totalGan);

console.log("\n7b. Comparación contra el índice");
await goto("/");
await page.getByRole("button", { name: /^Rendimiento$/ }).click();
await page.waitForTimeout(900);
const rend = await text();
check("muestra la leyenda con las dos series", await has("Tu cartera"), rend.slice(0, 200));
check("da el veredicto en palabras", /ganaste al|te ganó por|empataste/i.test(rend), rend.slice(0, 300));
await page.getByRole("button", { name: /^Valor$/ }).click();
await page.waitForTimeout(500);

console.log("\n7c. Lo que los gráficos dicen sin que los toques");
await goto("/");
await page.getByRole("button", { name: /^Todo$/ }).click();
await page.waitForTimeout(700);
// La banda entre las dos lineas es la ganancia: verde arriba del capital,
// roja abajo. Si no se dibuja, el grafico vuelve a ser dos lineas sueltas.
const banda = await page.evaluate(() =>
  [...document.querySelectorAll("svg path")]
    .map((el) => el.getAttribute("fill") ?? "")
    .filter((f) => f.includes("--color-pos") || f.includes("--color-neg")).length,
);
check("el gráfico pinta la ganancia entre las dos líneas", banda > 0, `tramos: ${banda}`);
await page.getByRole("button", { name: /^Rendimiento$/ }).click();
await page.waitForTimeout(900);
const leyenda = await text();
check(
  "cada serie lleva su número al lado del nombre",
  /tu cartera\s*[+-]?[\d.,]+%/i.test(leyenda.replace(/\n/g, " ")),
  leyenda.slice(0, 300),
);
await page.getByRole("button", { name: /^Valor$/ }).click();
await page.waitForTimeout(500);

await goto("/cartera");
await page.locator("button").filter({ hasText: "QQQ" }).first().click();
await page.waitForTimeout(1000);
check("la posición explica la línea de costo", await has("arriba de esa línea estás ganando"));
const marcas = await page.evaluate(
  () => document.querySelectorAll('[role="dialog"] svg circle').length,
);
// Tres compras de QQQ en la cartera de ejemplo, cada una con su halo.
check("marca cada movimiento sobre la curva", marcas >= 6, `círculos: ${marcas}`);
await page.locator('[aria-label="Cerrar"]').first().click();
await page.waitForTimeout(400);
// Lo que sigue mide sobre el gráfico del inicio: hay que volver ahí.
await goto("/");

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

console.log("\n9. Ajustes: índice, perfil y activos");
await goto("/ajustes");
check("es un índice de secciones", await has("Cuentas y activos"));
check("resume el estado de cada una sin entrar", await has("Tu perfil como inversor"));
check("no vuelca todo en una sola pantalla", !(await has("Tolerancia al riesgo")));

await goto("/ajustes/perfil");
await page.getByRole("button", { name: /^Agresivo$/ }).click();
await page.waitForTimeout(700);
await goto("/ajustes/perfil");
const agresivo = await page.getByRole("button", { name: /^Agresivo$/ }).getAttribute("data-active");
check("el perfil persiste tras recargar", agresivo === "true", `data-active=${agresivo}`);
await page.getByRole("link", { name: /^Ajustes$/ }).click();
await page.waitForTimeout(600);
check("se vuelve al índice desde la sección", await has("Cuentas y activos"));

await goto("/ajustes/cartera");
await page.getByRole("button", { name: /BTC/ }).first().click();
await page.waitForTimeout(600);
check("abre el editor de activo", await has("Símbolo en la fuente"));

// El boton de probar contesta en el momento si el simbolo cotiza: sin eso,
// adivinar proveedor y ticker es lo que hace abandonar una app.
await page.getByRole("button", { name: /Probar este símbolo/ }).click();
await page.waitForTimeout(2500);
check("prueba el símbolo contra el proveedor", await has("Anda:"), (await text()).slice(0, 250));

await page.locator('[role="dialog"] input.num').first().fill("NOEXISTEXYZ");
await page.waitForTimeout(300);
await page.getByRole("button", { name: /Probar este símbolo/ }).click();
await page.waitForTimeout(2500);
check(
  "avisa cuando el símbolo no cotiza",
  (await has("No cotizó")) || (await has("Anda:")),
  (await text()).slice(0, 250),
);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

console.log("\n10. Backup");
await goto("/ajustes/datos");
const download = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
await page.getByRole("button", { name: /^Exportar$/ }).click();
const file = await download;
check("exporta un backup", Boolean(file), file ? await file.suggestedFilename() : "sin descarga");

console.log("\n10b. Tirar para actualizar");
await goto("/");
await page.evaluate(() => window.scrollTo(0, 0));
await page.touchscreen.tap(180, 300);
// Gesto de arrastre hacia abajo desde arriba de todo.
await page.mouse.move(180, 120);
await page.dispatchEvent("body", "touchstart", {
  touches: [{ clientX: 180, clientY: 120, identifier: 0 }],
  changedTouches: [{ clientX: 180, clientY: 120, identifier: 0 }],
  targetTouches: [{ clientX: 180, clientY: 120, identifier: 0 }],
});
await page.dispatchEvent("body", "touchmove", {
  touches: [{ clientX: 180, clientY: 340, identifier: 0 }],
  changedTouches: [{ clientX: 180, clientY: 340, identifier: 0 }],
  targetTouches: [{ clientX: 180, clientY: 340, identifier: 0 }],
});
await page.waitForTimeout(300);
check("aparece el indicador al tirar", await has("actualizar"), (await text()).slice(0, 120));
await page.dispatchEvent("body", "touchend", {
  touches: [],
  changedTouches: [{ clientX: 180, clientY: 340, identifier: 0 }],
  targetTouches: [],
});
await page.waitForTimeout(2500);
check("la app sigue entera después del gesto", await has("Valor total"));

console.log("\n11. Persistencia entre sesiones");
await goto("/");
const before = normalize(await text()).match(/us\$ ([\d.,]+)/)?.[1];
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const after = normalize(await text()).match(/us\$ ([\d.,]+)/)?.[1];
check("el valor sobrevive a la recarga", Boolean(before) && before === after, `${before} vs ${after}`);

console.log("\n12. Consola limpia");
check("sin errores de consola", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

/*
 * El primer dia es el caso mas facil de romper y el que nadie prueba: un solo
 * movimiento, sin historia, con los graficos sin nada que dibujar. Va en un
 * contexto nuevo para arrancar con la base vacia.
 */
console.log("\n13. El primer día, con la base vacía");
const fresh = await browser.newContext(MOBILE);
const virgen = await fresh.newPage();
const erroresPrimerDia = [];
virgen.on("console", (m) => {
  const t = m.text();
  if (m.type() !== "error") return;
  if (/hmr|WebSocket|favicon|icon-192|Download the React/i.test(t)) return;
  erroresPrimerDia.push(t);
});
virgen.on("pageerror", (e) => erroresPrimerDia.push(`pageerror: ${e.message}`));

await virgen.goto(BASE, { waitUntil: "networkidle" });
await virgen.waitForTimeout(1500);
await virgen.getByRole("button", { name: /Cargar mi primer movimiento/ }).click();
await virgen.waitForTimeout(500);
await virgen.getByRole("button", { name: /escribirlo en una línea/i }).click();
await virgen.waitForTimeout(400);
await virgen.locator('input[placeholder*="QQQ"]').first().fill("pasé 300 dólares a cocos");
await virgen.waitForTimeout(800);
await virgen.getByRole("button", { name: /^Agregar$/ }).click();
await virgen.waitForTimeout(3500);

const primerDia = (await virgen.evaluate(() => document.body.innerText)).replace(/\u00a0/g, " ");
check("muestra el valor con un solo movimiento", /US\$ 300/.test(primerDia), primerDia.slice(0, 150));
check("explica que todavía no hay curva", /todavía no hay curva/i.test(primerDia), primerDia.slice(0, 400));
check("no dice «2 cuentas» con una sola usada", !/2 cuentas/i.test(primerDia));
check(
  "sin errores de consola en el primer día",
  erroresPrimerDia.length === 0,
  erroresPrimerDia.slice(0, 2).join(" | "),
);

// Al aparecer el segundo dia el grafico tiene que dibujarse de verdad: el
// componente pasa de su estado vacio al SVG, y con el cambia el nodo que
// mide el ancho.
await virgen.getByRole("button", { name: /agregar movimiento/i }).click();
await virgen.waitForTimeout(400);
await virgen.getByRole("button", { name: /escribirlo en una línea/i }).click();
await virgen.waitForTimeout(400);
await virgen.locator('input[placeholder*="QQQ"]').first().fill("pasé 200 dólares a cocos hace 5 días");
await virgen.waitForTimeout(800);
await virgen.getByRole("button", { name: /^Agregar$/ }).click();
await virgen.waitForTimeout(3000);

const conDosDias = (await virgen.evaluate(() => document.body.innerText)).replace(/\u00a0/g, " ");
check("ya no dice que falta historia", !/todavía no hay curva/i.test(conDosDias), conDosDias.slice(0, 200));
const trazos = await virgen.locator("svg path").count();
check("el gráfico se dibuja al haber dos días", trazos > 0, `${trazos} trazos`);
check(
  "sigue sin errores de consola",
  erroresPrimerDia.length === 0,
  erroresPrimerDia.slice(0, 2).join(" | "),
);
await fresh.close();

await browser.close();

console.log(`\n${passed} ok, ${failures.length} fallas`);
if (failures.length) {
  console.log("\nFallas:");
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
