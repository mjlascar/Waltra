import { describe, expect, it } from "vitest";
import { parseQuickEntry } from "@/lib/parse/quick-add";
import { parseLooseNumber } from "@/lib/parse/number";
import { extractDate } from "@/lib/parse/dates";
import type { Account, Asset } from "@/lib/types";

const accounts: Account[] = [
  { id: "cocos", name: "Cocos Capital", broker: "cocos", currency: "USD", createdAt: "" },
  { id: "binance", name: "Binance", broker: "binance", currency: "USD", createdAt: "" },
];

const assets: Asset[] = [
  {
    id: "a-qqq",
    symbol: "QQQ",
    name: "Invesco QQQ",
    kind: "etf",
    currency: "USD",
    source: "yahoo",
    sourceSymbol: "QQQ",
    precision: 6,
  },
];

const ctx = { accounts, assets, defaultAccountId: "cocos", now: "2025-06-15" };
const p = (text: string) => parseQuickEntry(text, ctx)!;

describe("parseLooseNumber", () => {
  it("entiende formato argentino y anglosajon", () => {
    expect(parseLooseNumber("1.234,56")).toBeCloseTo(1234.56);
    expect(parseLooseNumber("1,234.56")).toBeCloseTo(1234.56);
    expect(parseLooseNumber("1234.56")).toBeCloseTo(1234.56);
    expect(parseLooseNumber("0,5")).toBeCloseTo(0.5);
    expect(parseLooseNumber("0.001")).toBeCloseTo(0.001);
    expect(parseLooseNumber("1.500")).toBeCloseTo(1500);
    expect(parseLooseNumber("2k")).toBe(2000);
    expect(parseLooseNumber("100")).toBe(100);
    expect(parseLooseNumber("hola")).toBeNull();
  });
});

describe("extractDate", () => {
  it("entiende fechas relativas y numericas", () => {
    expect(extractDate("compre ayer", "2025-06-15")!.day).toBe("2025-06-14");
    expect(extractDate("hace 3 dias", "2025-06-15")!.day).toBe("2025-06-12");
    expect(extractDate("el 12/3", "2025-06-15")!.day).toBe("2025-03-12");
    expect(extractDate("12/03/2024", "2025-06-15")!.day).toBe("2024-03-12");
    expect(extractDate("el 3 de marzo", "2025-06-15")!.day).toBe("2025-03-03");
    // Una fecha sin anio que caeria en el futuro se asume del anio pasado.
    expect(extractDate("el 20/12", "2025-06-15")!.day).toBe("2024-12-20");
    expect(extractDate("sin fecha", "2025-06-15")).toBeNull();
  });
});

describe("parseQuickEntry", () => {
  it("la frase exacta que usa el usuario para depositar", () => {
    const r = p("pase 100 dolares a mi billetera de cocos");
    expect(r.type).toBe("deposit");
    expect(r.amount).toBe(100);
    expect(r.currency).toBe("USD");
    expect(r.accountId).toBe("cocos");
  });

  it("deposito con acentos y variantes", () => {
    expect(p("depósito 250 usd en binance").type).toBe("deposit");
    expect(p("cargué 500 en cocos").amount).toBe(500);
    expect(p("mandé 1.500 pesos a cocos").currency).toBe("ARS");
    expect(p("mandé 1.500 pesos a cocos").amount).toBe(1500);
  });

  it("compra con monto en plata y precio", () => {
    const r = p("compré 50 dólares de QQQ a 480");
    expect(r.type).toBe("buy");
    expect(r.basis).toBe("amount");
    expect(r.amount).toBe(50);
    expect(r.price).toBe(480);
    expect(r.quantity).toBeCloseTo(50 / 480);
    expect(r.symbol).toBe("QQQ");
    expect(r.assetId).toBe("a-qqq");
  });

  it("compra con cantidad fraccionaria de cripto", () => {
    const r = p("compré 0.01 BTC a 95000 en binance");
    expect(r.type).toBe("buy");
    expect(r.basis).toBe("quantity");
    expect(r.quantity).toBeCloseTo(0.01);
    expect(r.price).toBe(95000);
    expect(r.amount).toBeCloseTo(950);
    expect(r.symbol).toBe("BTC");
    expect(r.accountId).toBe("binance");
    expect(r.catalog?.source).toBe("binance");
  });

  it("compra por nombre en castellano", () => {
    const r = p("compré 200 de nasdaq a 500");
    expect(r.symbol).toBe("QQQ");
    expect(r.amount).toBe(200);
  });

  it("compra de acciones por unidades", () => {
    const r = p("compré 3 AAPL a 230");
    expect(r.basis).toBe("quantity");
    expect(r.quantity).toBe(3);
    expect(r.price).toBe(230);
    expect(r.amount).toBeCloseTo(690);
  });

  it("venta", () => {
    const r = p("vendí 2 QQQ a 520 ayer");
    expect(r.type).toBe("sell");
    expect(r.quantity).toBe(2);
    expect(r.price).toBe(520);
    expect(r.day).toBe("2025-06-14");
  });

  it("retiro", () => {
    const r = p("retiré 200 de binance");
    expect(r.type).toBe("withdraw");
    expect(r.amount).toBe(200);
    expect(r.accountId).toBe("binance");
  });

  it("transferencia entre cuentas propias", () => {
    const r = p("pasé 100 de cocos a binance");
    expect(r.type).toBe("transfer");
    expect(r.accountId).toBe("cocos");
    expect(r.counterAccountId).toBe("binance");
    expect(r.amount).toBe(100);
  });

  it("dividendo", () => {
    const r = p("dividendo 12 de QQQ");
    expect(r.type).toBe("dividend");
    expect(r.amount).toBe(12);
    expect(r.symbol).toBe("QQQ");
  });

  it("interes de cuenta remunerada", () => {
    const r = p("interés 3.40 en cocos");
    expect(r.type).toBe("interest");
    expect(r.amount).toBeCloseTo(3.4);
  });

  it("comision suelta", () => {
    const r = p("comisión 1.5 en binance");
    expect(r.type).toBe("fee");
    expect(r.amount).toBeCloseTo(1.5);
  });

  it("comision dentro de una compra", () => {
    const r = p("compré 2 QQQ a 500 comisión 3");
    expect(r.type).toBe("buy");
    expect(r.fee).toBe(3);
    expect(r.price).toBe(500);
    expect(r.quantity).toBe(2);
  });

  it("avisa cuando adivina en vez de fallar en silencio", () => {
    const r = p("500");
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThan(0.7);
  });

  it("texto vacio no produce nada", () => {
    expect(parseQuickEntry("   ", ctx)).toBeNull();
  });

  it("la confianza sube cuando la frase es completa", () => {
    const vago = p("100");
    const claro = p("compré 50 usd de QQQ a 480 en cocos");
    expect(claro.confidence).toBeGreaterThan(vago.confidence);
    expect(claro.confidence).toBeGreaterThan(0.8);
  });
});

describe("casos que aparecieron probando con frases reales", () => {
  it("una marca de moneda al final no convierte las unidades en plata", () => {
    // "2 qqq" son dos unidades, aunque despues diga "usd".
    const r = p("compré 2 qqq a 480 usd");
    expect(r.basis).toBe("quantity");
    expect(r.quantity).toBe(2);
    expect(r.amount).toBeCloseTo(960);
  });

  it("entiende las palabras que cuentan unidades", () => {
    const acciones = p("compré 3 acciones de AAPL a 230");
    expect(acciones.basis).toBe("quantity");
    expect(acciones.quantity).toBe(3);
    expect(acciones.amount).toBeCloseTo(690);

    const cedears = p("compré 10 cedears de AAPL a 500");
    expect(cedears.quantity).toBe(10);
  });

  it("el sustantivo también funciona como acción", () => {
    expect(p("ingreso 250 en cocos").type).toBe("deposit");
    expect(p("ingreso 250 en cocos").amount).toBe(250);
    expect(p("retiro 1000 de cocos").type).toBe("withdraw");
  });

  it("avisa cuando monto y cantidad son genuinamente ambiguos", () => {
    const r = p("compré 50 de QQQ");
    expect(r.basis).toBe("amount");
    expect(r.warnings.some((w) => w.includes("Por unidades"))).toBe(true);
  });

  it("no avisa cuando la frase dice la moneda", () => {
    const r = p("compré 50 usd de QQQ");
    expect(r.warnings.some((w) => w.includes("Por unidades"))).toBe(false);
  });

  it("marca «vender todo» para que la app complete la tenencia", () => {
    const r = p("vendí todo el QQQ");
    expect(r.type).toBe("sell");
    expect(r.symbol).toBe("QQQ");
    expect(r.all).toBe(true);
    // Sin monto, pero no es un error: la cantidad la pone la app.
    expect(r.warnings.some((w) => w.includes("monto"))).toBe(false);
  });

  it("una venta normal no queda marcada como total", () => {
    expect(p("vendí 2 QQQ a 520").all).toBeUndefined();
  });

  it("frases sueltas del día a día", () => {
    expect(p("le puse 300 a cocos").type).toBe("deposit");
    expect(p("saqué 100 de binance").type).toBe("withdraw");
    expect(p("cobré 15 de dividendos de QQQ").type).toBe("dividend");
    expect(p("rendimiento 2,5 en cocos").amount).toBeCloseTo(2.5);
    expect(p("comisión 0,75 en binance").type).toBe("fee");
    expect(p("metí 500 en binance ayer").day).toBe("2025-06-14");
  });
});

/**
 * El cuarto bug salido de una frase real: "compré 9 SPY por 456.345 pesos".
 * Sin marca de precio, la regla de "el segundo número es el precio unitario"
 * leía el total como precio y registraba 9 × 456.345 = 4,1 millones. "Por",
 * "pagando" y "pagué" introducen lo que salió del bolsillo; "a" introduce el
 * precio de cada una.
 */
describe("total pagado y unidades", () => {
  it("«por» después de las unidades es el total, no el precio", () => {
    const r = p("compré 9 SPY por 456345 pesos en cocos");
    expect(r.basis).toBe("total");
    expect(r.quantity).toBe(9);
    expect(r.amount).toBeCloseTo(456_345);
    expect(r.price).toBeCloseTo(50_705);
    expect(r.currency).toBe("ARS");
  });

  it("«pagando» y «pagué» también", () => {
    for (const frase of [
      "compré 9 cedears de SPY pagando 456.345 pesos",
      "compré 9 SPY, pagué 456345 pesos",
    ]) {
      const r = p(frase);
      expect(r.quantity).toBe(9);
      expect(r.price).toBeCloseTo(50_705);
    }
  });

  it("«a» sigue siendo el precio de cada una", () => {
    const r = p("compré 9 SPY a 50705 pesos");
    expect(r.basis).toBe("quantity");
    expect(r.amount).toBeCloseTo(456_345);
  });

  it("sin unidades, «por» es el monto invertido", () => {
    const r = p("compré por 50 dólares de QQQ");
    expect(r.amount).toBe(50);
    expect(r.basis).toBe("amount");
  });

  it("la comisión se separa del total, para el lado que corresponde", () => {
    // Lo cobrado ya viene sin la comisión: el bruto de la venta es mayor.
    const venta = p("vendí 2 QQQ por 1000 usd con comisión de 5");
    expect(venta.amount).toBeCloseTo(1005);
    expect(venta.price).toBeCloseTo(502.5);
    // Lo pagado ya la incluye: el bruto de la compra es menor.
    const compra = p("compré 2 QQQ por 1000 usd con comisión de 5");
    expect(compra.amount).toBeCloseTo(995);
    expect(compra.total).toBe(1000);
  });
});

describe("comprar dólares", () => {
  it("«compré 100 dólares a 1450» es un cambio de pesos a dólares", () => {
    const r = p("compré 100 dólares a 1450 en cocos");
    expect(r.type).toBe("exchange");
    expect(r.currency).toBe("ARS");
    expect(r.amount).toBeCloseTo(145_000);
    expect(r.toCurrency).toBe("USD");
    expect(r.toAmount).toBeCloseTo(100);
    expect(r.rate).toBeCloseTo(1450);
  });

  it("con dos de los tres números deduce el tercero", () => {
    expect(p("compré dólares por 145000 pesos a 1450").toAmount).toBeCloseTo(100);
    expect(p("compré 100 dólares por 145000 pesos").rate).toBeCloseTo(1450);
  });

  it("vender dólares es el cambio al revés", () => {
    const r = p("vendí 100 dólares a 1400");
    expect(r.type).toBe("exchange");
    expect(r.currency).toBe("USD");
    expect(r.amount).toBeCloseTo(100);
    expect(r.toCurrency).toBe("ARS");
    expect(r.toAmount).toBeCloseTo(140_000);
  });

  it("si falta el dólar, lo pide en vez de inventarlo", () => {
    const r = p("compré 100 dólares");
    expect(r.type).toBe("exchange");
    expect(r.amount).toBeUndefined();
    expect(r.warnings.join(" ")).toMatch(/dólar/);
  });

  it("con un activo en la frase sigue siendo una compra", () => {
    const r = p("compré 50 dólares de QQQ");
    expect(r.type).toBe("buy");
    expect(r.symbol).toBe("QQQ");
  });

  it("un ingreso en dólares no es un cambio", () => {
    expect(p("ingresé 500 dólares a cocos").type).toBe("deposit");
  });
});
