/**
 * Inyecta un informe de muestra en la base local y captura la pantalla de
 * Insights.
 *
 * Generar uno de verdad consume creditos y necesita clave; esto permite
 * revisar el renderizado (y que un informe degradado se vea decente) sin
 * gastar nada.
 */
import { chromium } from "playwright";
import { MOBILE, chromiumPath } from "./browser.mjs";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
mkdirSync("screenshots", { recursive: true });

const REPORT = {
  id: "muestra-1",
  createdAt: new Date().toISOString(),
  model: "claude-opus-5",
  marketBrief:
    "La semana estuvo marcada por el dato de inflación de Estados Unidos, que salió por debajo de lo esperado y empujó al Nasdaq a máximos. En cripto, los flujos hacia ETFs spot de Bitcoin volvieron a ser positivos después de tres semanas de salidas. En el plano local, el MEP se movió poco y el riesgo país cerró estable.",
  signals: [
    {
      symbol: "QQQ",
      action: "mantener",
      confidence: "alta",
      headline: "El motor sigue siendo el mismo puñado de empresas",
      rationale:
        "QQQ es el 38% de tu cartera y su rendimiento depende de cinco compañías que pesan más de la mitad del índice. Con la inflación cediendo el contexto le juega a favor, pero sumar más acá te concentra todavía más en el mismo riesgo.",
      horizon: "6-12 meses",
    },
    {
      symbol: "BTC",
      action: "reducir",
      confidence: "media",
      headline: "Ya es más de un cuarto de tu cartera",
      rationale:
        "Compraste a un promedio de US$ 69.091 y hoy acumulás 38,9%. El peso subió al 27,6% sin que hayas decidido llevarlo ahí: lo llevó el precio. Para un perfil moderado a 5 años, tomar parte de esa ganancia devuelve la cartera a donde la habías pensado.",
      horizon: "3-6 meses",
    },
    {
      symbol: "SPY",
      action: "vigilar",
      confidence: "baja",
      headline: "Se superpone casi por completo con QQQ",
      rationale:
        "Entre SPY y QQQ tenés exposición repetida a las mismas empresas grandes. No es un error, pero tampoco te está diversificando tanto como parece por tener dos ETFs distintos.",
      horizon: "sin apuro",
    },
  ],
  profileRead: {
    summary:
      "Aportás de forma regular y comprás enseguida: en 400 días hiciste 18 movimientos y casi nunca dejaste plata quieta más de un día. Eso es disciplina, no impulso. Pero tus compras se concentran en lo que ya venía subiendo, y eso hizo que la cartera se vuelva más agresiva de lo que declarás.",
    observations: [
      "Ocho ingresos de capital en 13 meses, bastante parejos: estás haciendo compras programadas sin llamarlo así.",
      "Una sola venta en todo el período, y fue parcial. No operás de más.",
      "El 6% de la cartera quedó en efectivo sin invertir.",
    ],
    risks: [
      "Concentración: QQQ y SPY juntos son más de la mitad, y se superponen entre sí.",
      "Tu perfil declarado es moderado, pero la cartera real tiene 28% en cripto.",
      "Toda la cartera está en dólares: si tus gastos son en pesos, el MEP te mueve el resultado.",
    ],
    suggestions: [
      "Fijar un tope de peso para cripto y rebalancear cuando lo pase, en vez de decidirlo cada vez.",
      "Antes de sumar otro ETF de Estados Unidos, mirar cuánto se superpone con lo que ya tenés.",
      "Poner a trabajar el efectivo quieto, aunque sea en una cuenta remunerada.",
    ],
  },
  sources: [
    { title: "reuters.com", url: "https://www.reuters.com/markets/us/inflation-data" },
    { title: "bloomberglinea.com", url: "https://www.bloomberglinea.com/mercados/etf-bitcoin" },
    { title: "ambito.com", url: "https://www.ambito.com/contenidos/dolar-mep.html" },
  ],
  portfolioDigest: "(muestra)",
};

const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"] });
const page = await (
  // Escala 1: estas capturas terminan en el README, donde se ven a 220 px.
  await browser.newContext({ ...MOBILE, deviceScaleFactor: 1 })
).newPage();

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const demo = page.getByRole("button", { name: /datos de ejemplo/i });
if (await demo.count()) {
  await demo.click();
  await page.waitForTimeout(4000);
}

async function inject(report) {
  await page.evaluate(
    (row) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("waltra");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("insights", "readwrite");
          tx.objectStore("insights").put(row);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        };
      }),
    report,
  );
}

await inject(REPORT);
await page.goto(`${BASE}/insights`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: "screenshots/insights-completo.png", fullPage: true });
console.log("· screenshots/insights-completo.png");
// Version recortada para el README: la completa es muy larga para leerla.
// Bajamos hasta el informe: arriba esta la tarjeta de generar, que no es lo
// que hay que mostrar en el README.
await page.evaluate(() => window.scrollTo(0, 430));
await page.waitForTimeout(500);
await page.screenshot({ path: "docs/img/insights.png" });
console.log("· docs/img/insights.png");

// Y ahora el caso degradado, que es el que nadie mira hasta que pasa.
await inject({
  ...REPORT,
  id: "muestra-2",
  createdAt: new Date(Date.now() + 1000).toISOString(),
  degraded: true,
  signals: [],
  profileRead: { summary: "", observations: [], risks: [], suggestions: [] },
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: "screenshots/insights-degradado.png", fullPage: true });
console.log("· screenshots/insights-degradado.png");

await browser.close();
