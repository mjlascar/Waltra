import { afterEach, describe, expect, it, vi } from "vitest";
import { binanceHistory, binanceQuotes } from "@/lib/market/binance";
import { yahooHistory, yahooQuote } from "@/lib/market/yahoo";
import { bymaQuotes } from "@/lib/market/byma";
import { fxHistory, fxLatest } from "@/lib/market/fx";
import type { MarketRef } from "@/lib/market/types";

/**
 * Estos proveedores hablan con APIs publicas que no se pueden alcanzar desde
 * CI, asi que lo que se verifica es la traduccion de sus respuestas al modelo
 * de la app, incluido que un error no se propague como excepcion: si una
 * fuente se cae, la app tiene que seguir funcionando con lo que ya guardo.
 */

type Handler = (url: string) => { status?: number; body: unknown } | undefined;

function mockFetch(handler: Handler) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    const result = handler(url);
    if (!result) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

afterEach(() => vi.unstubAllGlobals());

const btc: MarketRef = {
  assetId: "a1",
  symbol: "BTC",
  source: "binance",
  sourceSymbol: "BTCUSDT",
  currency: "USD",
};

describe("Binance", () => {
  it("traduce el ticker de 24 horas", async () => {
    mockFetch((url) =>
      url.includes("ticker/24hr")
        ? { body: [{ symbol: "BTCUSDT", lastPrice: "96000.50", priceChangePercent: "-2.35" }] }
        : undefined,
    );
    const [quote] = await binanceQuotes([btc]);
    expect(quote.price).toBeCloseTo(96000.5);
    expect(quote.changePct).toBeCloseTo(-0.0235);
    expect(quote.source).toBe("binance");
    expect(quote.error).toBeUndefined();
  });

  it("marca el simbolo que el proveedor no conoce", async () => {
    mockFetch(() => ({ body: [] }));
    const [quote] = await binanceQuotes([btc]);
    expect(quote.price).toBeNull();
    expect(quote.error).toMatch(/no encontrado/);
  });

  it("no lanza cuando la API responde error", async () => {
    mockFetch(() => ({ status: 503, body: { msg: "caido" } }));
    const [quote] = await binanceQuotes([btc]);
    expect(quote.price).toBeNull();
    expect(quote.error).toContain("503");
  });

  it("arma la serie diaria desde las velas", async () => {
    const day = 86_400_000;
    const start = Date.parse("2026-01-01T00:00:00.000Z");
    mockFetch((url) =>
      url.includes("klines")
        ? {
            body: [
              [start, "90000", "97000", "89000", "95000", "1"],
              [start + day, "95000", "99000", "94000", "98000", "1"],
            ],
          }
        : undefined,
    );
    const history = await binanceHistory({ ...btc, from: "2026-01-01" });
    expect(history.points).toEqual([
      { date: "2026-01-01", close: 95000 },
      { date: "2026-01-02", close: 98000 },
    ]);
  });

  it("devuelve serie vacia sin romper si falla", async () => {
    mockFetch(() => ({ status: 500, body: {} }));
    const history = await binanceHistory({ ...btc, from: "2026-01-01" });
    expect(history.points).toEqual([]);
    expect(history.error).toBeTruthy();
  });
});

const qqq: MarketRef = {
  assetId: "a2",
  symbol: "QQQ",
  source: "yahoo",
  sourceSymbol: "QQQ",
  currency: "USD",
};

describe("Yahoo Finance", () => {
  const chart = (over: Record<string, unknown> = {}) => ({
    chart: {
      error: null,
      result: [
        {
          meta: { regularMarketPrice: 512.4, chartPreviousClose: 500, currency: "USD" },
          timestamp: [
            Date.parse("2026-01-02T14:30:00.000Z") / 1000,
            Date.parse("2026-01-03T14:30:00.000Z") / 1000,
          ],
          indicators: { quote: [{ close: [498.1, 512.4] }] },
          ...over,
        },
      ],
    },
  });

  it("lee el precio y la variacion del dia", async () => {
    mockFetch(() => ({ body: chart() }));
    const quote = await yahooQuote(qqq);
    expect(quote.price).toBeCloseTo(512.4);
    expect(quote.changePct).toBeCloseTo(512.4 / 500 - 1);
  });

  it("propaga el error de Yahoo como texto, no como excepcion", async () => {
    mockFetch(() => ({ body: { chart: { error: { description: "No data found" }, result: null } } }));
    const quote = await yahooQuote(qqq);
    expect(quote.price).toBeNull();
    expect(quote.error).toContain("No data found");
  });

  it("descarta los cierres nulos de la serie", async () => {
    mockFetch(() => ({
      body: chart({ indicators: { quote: [{ close: [498.1, null] }] } }),
    }));
    const history = await yahooHistory({ ...qqq, from: "2026-01-01" });
    expect(history.points).toHaveLength(1);
    expect(history.points[0].close).toBeCloseTo(498.1);
  });

  it("no rompe si no viene result", async () => {
    mockFetch(() => ({ body: {} }));
    const history = await yahooHistory({ ...qqq, from: "2026-01-01" });
    expect(history.points).toEqual([]);
    expect(history.error).toBeTruthy();
  });
});

const ggal: MarketRef = {
  assetId: "a3",
  symbol: "GGAL",
  source: "byma",
  sourceSymbol: "GGAL",
  currency: "ARS",
};

describe("BYMA / data912", () => {
  it("lee el ultimo operado del panel", async () => {
    mockFetch((url) =>
      url.includes("arg_stocks")
        ? { body: [{ symbol: "GGAL", c: 7250.5, pct_change: 1.8 }] }
        : { body: [] },
    );
    const [quote] = await bymaQuotes([ggal]);
    expect(quote.price).toBeCloseTo(7250.5);
    expect(quote.changePct).toBeCloseTo(0.018);
  });

  it("usa el punto medio del libro cuando no hay ultimo operado", async () => {
    mockFetch((url) =>
      url.includes("arg_cedears")
        ? { body: [{ ticker: "AAPL", px_bid: 1000, px_ask: 1100 }] }
        : { body: [] },
    );
    const [quote] = await bymaQuotes([
      { ...ggal, assetId: "a4", symbol: "AAPL", sourceSymbol: "AAPL" },
    ]);
    expect(quote.price).toBeCloseTo(1050);
  });

  it("quita el sufijo de Yahoo al buscar en el panel local", async () => {
    mockFetch((url) =>
      url.includes("arg_stocks") ? { body: [{ symbol: "GGAL", c: 7000 }] } : { body: [] },
    );
    const [quote] = await bymaQuotes([{ ...ggal, sourceSymbol: "GGAL.BA" }]);
    expect(quote.price).toBeCloseTo(7000);
  });

  it("cae a Yahoo cuando data912 no responde", async () => {
    mockFetch((url) => {
      if (url.includes("data912")) return { status: 502, body: {} };
      if (url.includes("finance.yahoo.com")) {
        return {
          body: {
            chart: {
              error: null,
              result: [
                {
                  meta: { regularMarketPrice: 7100, chartPreviousClose: 7000 },
                  timestamp: [],
                  indicators: { quote: [{ close: [] }] },
                },
              ],
            },
          },
        };
      }
      return undefined;
    });
    const [quote] = await bymaQuotes([ggal]);
    expect(quote.price).toBeCloseTo(7100);
    expect(quote.source).toBe("byma");
  });
});

describe("Dólar MEP", () => {
  it("toma el punto medio entre compra y venta", async () => {
    mockFetch(() => ({
      body: { casa: "bolsa", compra: 1200, venta: 1260, fechaActualizacion: "2026-09-20T18:00:00.000Z" },
    }));
    const rate = await fxLatest();
    expect(rate?.arsPerUsd).toBeCloseTo(1230);
    expect(rate?.date).toBe("2026-09-20");
  });

  it("devuelve null si la fuente se cae, en vez de romper", async () => {
    mockFetch(() => ({ status: 500, body: {} }));
    expect(await fxLatest()).toBeNull();
  });

  it("ordena la serie historica", async () => {
    mockFetch(() => ({
      body: [
        { casa: "bolsa", fecha: "2026-02-01", compra: 1100, venta: 1150 },
        { casa: "bolsa", fecha: "2026-01-01", compra: 1000, venta: 1050 },
        { casa: "bolsa", fecha: "2026-03-01", venta: 1300 },
      ],
    }));
    const rates = await fxHistory();
    expect(rates.map((r) => r.date)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(rates[0].arsPerUsd).toBeCloseTo(1025);
    expect(rates[2].arsPerUsd).toBeCloseTo(1300);
  });

  it("serie vacia si la fuente falla", async () => {
    mockFetch(() => ({ status: 404, body: {} }));
    expect(await fxHistory()).toEqual([]);
  });
});

describe("Yahoo: el segundo host", () => {
  it("prueba query2 cuando query1 responde error", async () => {
    const vistos: string[] = [];
    mockFetch((url) => {
      vistos.push(url);
      if (url.includes("query1")) return { status: 429, body: { msg: "too many" } };
      return {
        body: {
          chart: {
            error: null,
            result: [
              {
                meta: { regularMarketPrice: 500, chartPreviousClose: 490 },
                timestamp: [],
                indicators: { quote: [{ close: [] }] },
              },
            ],
          },
        },
      };
    });
    const quote = await yahooQuote(qqq);
    expect(quote.price).toBeCloseTo(500);
    expect(vistos.some((u) => u.includes("query1"))).toBe(true);
    expect(vistos.some((u) => u.includes("query2"))).toBe(true);
  });

  it("si los dos fallan, informa el error sin lanzar", async () => {
    mockFetch(() => ({ status: 500, body: {} }));
    const quote = await yahooQuote(qqq);
    expect(quote.price).toBeNull();
    expect(quote.error).toContain("500");
  });
});
