/**
 * Recorrido de la sincronizacion con Drive, con Google simulado.
 *
 * Dos telefonos —dos contextos, cada uno con su base— contra un Drive en
 * memoria que se porta como la API v2: etag, If-Match y 412. Google de verdad
 * no se puede probar sin un cliente OAuth y una cuenta; esto prueba todo lo
 * demas, en la pantalla: conectar, bajar, combinar cambios de los dos, frenar
 * un Borrar todo, resolver un choque, la copia de recuperacion y desvincular.
 *
 * La app tiene que estar levantada con un cliente de mentira:
 *   NEXT_PUBLIC_GOOGLE_CLIENT_ID=prueba.apps.googleusercontent.com WALTRA_MOCK=1 npm run dev
 * Uso: node scripts/drive-e2e.mjs   (SHOTS=carpeta para guardar capturas)
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { MOBILE, chromiumPath } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let passed = 0;
const failures = [];
function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FALLA ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- Drive en memoria -------------------------------------------------------

const TOKEN = "token-de-prueba";
const files = new Map();
let revision = 0;
let created = 0;
const meta = (id, f) => ({ id, etag: f.etag, modifiedDate: f.modifiedDate, fileSize: String(Buffer.byteLength(f.body)) });
function store(id, body) {
  files.set(id, { body, etag: `"rev-${++revision}"`, modifiedDate: new Date().toISOString() });
  return meta(id, files.get(id));
}
/** La cartera que hay en Drive, o null. */
function remote() {
  const [file] = files.values();
  return file ? JSON.parse(file.body) : null;
}
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, if-match",
  "access-control-allow-methods": "GET, POST, PUT, DELETE",
};

async function drive(route) {
  const request = route.request();
  const url = new URL(request.url());
  const method = request.method();
  const headers = request.headers();
  const json = (status, body) => route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (method === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
  if (headers.authorization !== `Bearer ${TOKEN}`) return json(401, {});
  if (method === "GET" && url.pathname === "/drive/v2/files") {
    return json(200, { items: [...files].map(([id, f]) => meta(id, f)) });
  }
  if (method === "POST" && url.pathname === "/upload/drive/v2/files") {
    const boundary = headers["content-type"].split("boundary=")[1];
    const payload = request.postData().split(`--${boundary}`)[2].replace(/^\r\n[^\r\n]+\r\n\r\n/, "").replace(/\r\n$/, "");
    return json(200, store(`archivo-${++created}`, payload));
  }
  const match = url.pathname.match(/^\/(?:upload\/)?drive\/v2\/files\/([^/]+)$/);
  const id = match && decodeURIComponent(match[1]);
  const file = id && files.get(id);
  if (!file) return json(404, {});
  if (headers["if-match"] && headers["if-match"] !== file.etag) return json(412, {});
  if (method === "GET") {
    return url.searchParams.get("alt") === "media"
      ? route.fulfill({ status: 200, headers: CORS, body: file.body })
      : json(200, meta(id, file));
  }
  if (method === "PUT") return json(200, store(id, request.postData()));
  if (method === "DELETE") { files.delete(id); return route.fulfill({ status: 204, headers: CORS }); }
  return json(400, { error: `no simulado: ${method} ${url.pathname}` });
}

/** Google Identity Services: entrega el token apenas se lo piden. */
const GIS = `window.google = { accounts: { oauth2: { initTokenClient(config) {
  return { requestAccessToken() { setTimeout(() => config.callback({ access_token: "${TOKEN}", expires_in: 3600,
    scope: "openid email profile https://www.googleapis.com/auth/drive.appdata" }), 50); } };
} } } };`;

// --- Telefonos ---------------------------------------------------------------

const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"] });
const consoleErrors = [];

async function phone(name) {
  const context = await browser.newContext(MOBILE);
  await context.route("https://accounts.google.com/**", (route) =>
    route.fulfill({ status: 200, headers: { "content-type": "application/javascript" }, body: GIS }));
  await context.route("https://openidconnect.googleapis.com/**", (route) => route.fulfill({
    status: 200, headers: { ...CORS, "content-type": "application/json" },
    body: JSON.stringify({ sub: "usuario-1", email: "prueba@example.com", name: "Cuenta de prueba" }),
  }));
  await context.route("https://www.googleapis.com/**", drive);
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`${name}: ${m.text()}`); });
  page.on("pageerror", (e) => consoleErrors.push(`${name}: ${e.message}`));
  const text = async () => (await page.evaluate(() => document.body.innerText)).replace(/ /g, " ");
  const has = async (needle) => (await text()).toLowerCase().includes(needle.toLowerCase());
  return {
    page, text, has,
    /** Recarga la pagina: en la web, eso pierde el token, que vive en memoria. */
    async goto(path) {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
    },
    /** Navega adentro de la app, como un toque: la sesion sigue. */
    async nav(path) {
      await page.evaluate((target) => window.next.router.push(target), path);
      await page.waitForURL((u) => u.pathname === path, { timeout: 10_000 });
      await page.waitForTimeout(700);
    },
    /** Espera hasta que aparezca un texto, o se cumpla una condicion. */
    async until(what, timeout = 15_000) {
      const test = typeof what === "string" ? () => has(what) : what;
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (await test()) return true;
        await page.waitForTimeout(250);
      }
      return false;
    },
    async shot(file) {
      if (SHOTS) await page.screenshot({ path: join(SHOTS, file), fullPage: true });
    },
    async add(sentence) {
      await page.getByRole("button", { name: /agregar movimiento/i }).click();
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: /escribirlo en una línea/i }).click();
      await page.waitForTimeout(400);
      await page.locator('input[placeholder*="QQQ"]').first().fill(sentence);
      await page.waitForTimeout(900);
      await page.getByRole("button", { name: /^Agregar$/ }).click();
      await page.waitForTimeout(1500);
      // Si la hoja quedo abierta (un aviso, la confirmacion), se cierra: con la
      // hoja arriba, el resto de la pantalla no se puede tocar.
      const cerrar = page.locator('[aria-label="Cerrar"]').first();
      if (await cerrar.isVisible().catch(() => false)) {
        await cerrar.click();
        await page.waitForTimeout(400);
      }
    },
    async connect() {
      await this.goto("/ajustes/cuenta");
      await page.getByRole("button", { name: /^Conectar Google Drive$/ }).click();
    },
    async choose(label) {
      await page.getByRole("radio", { name: new RegExp(label) }).check();
      await page.getByRole("button", { name: /^Confirmar$/ }).click();
    },
  };
}
const amounts = () => (remote()?.transactions ?? []).map((t) => t.amount);

const a = await phone("A");
const b = await phone("B");

console.log("\n1. Un teléfono con datos se conecta y sube su cartera");
await a.goto("/");
await a.page.getByRole("button", { name: /datos de ejemplo/i }).click();
await a.page.waitForTimeout(4000);
// Los datos de ejemplo no cuentan para el freno de borrados grandes (se
// limpian de a muchos a proposito): hace falta una cartera propia.
await a.add("ingresé 1000 dólares a cocos");
await a.goto("/ajustes");
check("con cliente de Google, Ajustes ofrece conectarlo", await a.has("Cuenta y sincronización"));
await a.connect();
check("queda sincronizado", await a.until("Sincronizado"), (await a.text()).slice(0, 400));
await a.shot("1-conectado.png");
const inicial = remote()?.transactions.length ?? 0;
check("Drive tiene la cartera", inicial > 0 && files.size === 1, `${files.size} archivos, ${inicial} movimientos`);
check("ninguna clave ni dato del dispositivo viaja", ![...files.values()].some((f) => /apiKey|geminiKey|accessKey|lastQuoteSync/.test(f.body)));

console.log("\n2. Un teléfono nuevo se conecta y la baja");
await b.connect();
check("el segundo teléfono queda sincronizado", await b.until("Sincronizado"));
await b.nav("/");
check("ve la cartera sin cargar nada", await b.until("Valor total"));
check("no creó otra copia en Drive", files.size === 1);

console.log("\n3. Movimientos cargados en los dos, uno sin sesión, se combinan");
await a.page.getByRole("button", { name: /^Desconectar$/ }).click();
check("desconectar deja la instalación vinculada", await a.until("Vinculada a prueba@example.com"));
await a.nav("/");
await a.add("ingresé 123 dólares a cocos");
await b.add("ingresé 456 dólares a binance");
check("el que tiene sesión sube su movimiento solo", await b.until(() => amounts().includes(456)), amounts().slice(-3).join(", "));
await a.connect();
check("al reconectar combina sin preguntar", await a.until("Sincronizado"), (await a.text()).slice(0, 400));
check("Drive tiene los movimientos de los dos", amounts().includes(123) && amounts().includes(456));
check("no hubo nada que elegir", !(await a.has("Confirmar")));
await a.nav("/movimientos");
check("el que reconectó ve el movimiento del otro", await a.until("456"));
await b.nav("/ajustes/cuenta");
await b.page.getByRole("button", { name: /^Sincronizar ahora$/ }).click();
await b.nav("/movimientos");
check("y el otro ve el suyo", await b.until("123"));

console.log("\n4. Borrar todo no vacía Drive sin preguntar");
await a.nav("/ajustes/datos");
await a.page.locator('input[placeholder="BORRAR"]').fill("BORRAR");
await a.page.locator('input[placeholder="BORRAR"] + button').click();
await a.page.waitForTimeout(2500);
await a.nav("/ajustes/cuenta");
check("frena y pregunta", await a.until("Se borraría casi toda la cartera"), (await a.text()).slice(0, 500));
check("Drive sigue con la cartera", amounts().length === inicial + 2, `${amounts().length} movimientos`);
await a.shot("4-borrado-frenado.png");
await a.choose("La copia de Drive");
check("elegir Drive la recupera", await a.until("Sincronizado"));
await a.nav("/");
check("la cartera vuelve al teléfono", await a.until("Valor total"));

console.log("\n5. Lo mismo cambiado en los dos se pregunta, y lo pisado queda guardado");
await a.nav("/ajustes/cuenta");
await a.page.getByRole("button", { name: /^Desconectar$/ }).click();
await a.nav("/ajustes/perfil");
await a.page.getByRole("button", { name: /^Agresivo$/ }).click();
await a.page.waitForTimeout(600);
await b.nav("/ajustes/perfil");
// El primer boton del selector toma como nombre accesible el rotulo entero
// (vive adentro de un <label>): se lo busca por texto.
await b.page.locator(".segmented button", { hasText: "Conservador" }).click();
check("el otro sube su cambio", await b.until(() => remote()?.settings.riskProfile === "conservador"));
await a.connect();
check("pregunta por el choque", await a.until("Los dos lados cambiaron lo mismo"), (await a.text()).slice(0, 500));
await a.shot("5-choque.png");
await a.choose("Combinar, y donde chocan, Drive");
check("resuelve hacia Drive", await a.until("Sincronizado"));
check("queda la copia de recuperación de este teléfono", await a.until("De este dispositivo"));
await a.shot("5-recuperacion.png");

console.log("\n6. Desvincular");
await a.page.getByRole("button", { name: /^Desvincular$/ }).click();
await a.page.getByRole("button", { name: /^Sí, desvincular$/ }).click();
check("vuelve a ofrecer conectar", await a.until("Conectar Google Drive"));
check("ya no dice con qué cuenta está vinculada", await a.until(async () => !(await a.has("Vinculada a")), 5_000));
await a.nav("/ajustes");
check("Ajustes la muestra solo en el dispositivo", await a.has("solo en este dispositivo"));

check("sin errores de consola", consoleErrors.length === 0, consoleErrors.slice(0, 5).join(" | "));
await browser.close();
console.log(`\n${passed} ok, ${failures.length} fallas`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
