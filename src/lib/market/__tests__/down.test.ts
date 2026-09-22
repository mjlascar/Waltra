import { describe, expect, it } from "vitest";
import { proveedoresCaidos } from "@/lib/market/down";

/**
 * La diferencia importa: un proveedor caido se avisa como tal, un ticker que
 * no cotiza se avisa por separado. Confundirlos lleva a decir "Yahoo no
 * responde" cuando en realidad hay un simbolo mal escrito.
 */
const q = (source: string, price: number | null) => ({ source, price }) as never;

describe("proveedores caídos", () => {
  it("sin fallas no reporta nada", () => {
    expect(proveedoresCaidos([q("binance", 95000), q("yahoo", 500)])).toEqual([]);
  });

  it("un proveedor que no devolvió ni un precio está caído", () => {
    expect(proveedoresCaidos([q("yahoo", null), q("yahoo", null), q("binance", 95000)])).toEqual([
      "Yahoo Finance",
    ]);
  });

  it("un solo ticker sin precio no tumba al proveedor", () => {
    expect(proveedoresCaidos([q("yahoo", null), q("yahoo", 500)])).toEqual([]);
  });

  it("puede haber más de uno", () => {
    expect(proveedoresCaidos([q("yahoo", null), q("byma", null)]).sort()).toEqual([
      "Yahoo Finance",
      "data912",
    ]);
  });

  it("los precios manuales no cuentan: no tienen proveedor que pueda caerse", () => {
    expect(proveedoresCaidos([q("manual", null), q("binance", 95000)])).toEqual([]);
  });

  it("sin activos de un proveedor, ese proveedor no se menciona", () => {
    expect(proveedoresCaidos([q("binance", 95000)])).toEqual([]);
  });
});
