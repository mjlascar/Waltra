import { afterEach, describe, expect, it, vi } from "vitest";
import { searchSymbols } from "@/lib/market/search";

/**
 * El buscador es el unico lugar de la app que traduce un nombre a un simbolo,
 * asi que se prueba contra la forma real de la respuesta de Yahoo y no contra
 * una version idealizada.
 */
function respondeCon(quotes: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ quotes }),
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("buscar por nombre", () => {
  it("encuentra una acción por el nombre de la empresa", async () => {
    respondeCon([
      { symbol: "NKE", shortname: "NIKE, Inc.", longname: "NIKE, Inc.", quoteType: "EQUITY", exchDisp: "NYSE", isYahooFinance: true },
    ]);
    const [hit] = await searchSymbols("nike");
    expect(hit).toMatchObject({
      symbol: "NKE",
      name: "NIKE, Inc.",
      kind: "stock",
      currency: "USD",
      source: "yahoo",
      sourceSymbol: "NKE",
    });
  });

  it("los tickers argentinos van al mercado local y en pesos", async () => {
    respondeCon([
      { symbol: "GGAL.BA", shortname: "Grupo Financiero Galicia", quoteType: "EQUITY", exchDisp: "Buenos Aires", isYahooFinance: true },
    ]);
    const [hit] = await searchSymbols("galicia");
    expect(hit).toMatchObject({ symbol: "GGAL.BA", source: "byma", currency: "ARS", precision: 2 });
  });

  it("la cripto se traduce al símbolo que usa Binance", async () => {
    respondeCon([
      { symbol: "BTC-USD", shortname: "Bitcoin USD", quoteType: "CRYPTOCURRENCY", isYahooFinance: true },
    ]);
    const [hit] = await searchSymbols("bitcoin");
    // Nuestro proveedor de cripto es Binance, que lo llama BTCUSDT.
    expect(hit).toMatchObject({ symbol: "BTC", source: "binance", sourceSymbol: "BTCUSDT" });
  });

  it("un ETF se marca como ETF y un fondo como fondo", async () => {
    respondeCon([
      { symbol: "QQQ", shortname: "Invesco QQQ Trust", quoteType: "ETF", isYahooFinance: true },
      { symbol: "VFIAX", shortname: "Vanguard 500 Index", quoteType: "MUTUALFUND", isYahooFinance: true },
    ]);
    const hits = await searchSymbols("indice");
    expect(hits.map((h) => h.kind)).toEqual(["etf", "fund"]);
  });

  it("descarta lo que no se puede tener en cartera", async () => {
    respondeCon([
      { symbol: "^GSPC", shortname: "S&P 500", quoteType: "INDEX", isYahooFinance: true },
      { symbol: "ARS=X", shortname: "USD/ARS", quoteType: "CURRENCY", isYahooFinance: true },
      { symbol: "ESZ26.CME", shortname: "E-Mini", quoteType: "FUTURE", isYahooFinance: true },
      { symbol: "AAPL", shortname: "Apple Inc.", quoteType: "EQUITY", isYahooFinance: true },
    ]);
    const hits = await searchSymbols("sp500");
    expect(hits.map((h) => h.symbol)).toEqual(["AAPL"]);
  });

  it("descarta lo que Yahoo no cotiza: sin precio no sirve de nada", async () => {
    respondeCon([
      { symbol: "PRIVADA", shortname: "Empresa privada", quoteType: "EQUITY", isYahooFinance: false },
    ]);
    expect(await searchSymbols("privada")).toEqual([]);
  });

  it("no repite el mismo símbolo", async () => {
    respondeCon([
      { symbol: "NKE", shortname: "NIKE", quoteType: "EQUITY", isYahooFinance: true },
      { symbol: "NKE", shortname: "NIKE Inc", quoteType: "EQUITY", isYahooFinance: true },
    ]);
    expect(await searchSymbols("nike")).toHaveLength(1);
  });

  it("con una sola letra no sale a buscar", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await searchSymbols("n")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("una respuesta sin resultados no revienta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    expect(await searchSymbols("nada")).toEqual([]);
  });
});

describe("el catálogo local, que resuelve sin red", () => {
  it("ahora conoce Nike", async () => {
    const { searchCatalog, lookupCatalog } = await import("@/lib/catalog");
    expect(searchCatalog("nike")[0]?.symbol).toBe("NKE");
    // Y también por el ticker, que es como lo escribe quien ya lo sabe.
    expect(lookupCatalog("NKE")?.name).toBe("Nike");
  });

  it("los nombres con puntuación igual se encuentran", async () => {
    const { searchCatalog } = await import("@/lib/catalog");
    expect(searchCatalog("mcdonalds")[0]?.symbol).toBe("MCD");
    expect(searchCatalog("berkshire")[0]?.symbol).toBe("BRK-B");
  });
});
