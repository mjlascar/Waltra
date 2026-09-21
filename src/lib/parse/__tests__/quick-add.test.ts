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
