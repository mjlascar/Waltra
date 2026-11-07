import { describe, expect, it } from "vitest";
import { parseBulk } from "@/lib/parse/bulk";
import { aplicarEdicion, cambiar, edicionDe } from "@/lib/parse/bulk-edit";
import type { Account } from "@/lib/types";

const accounts: Account[] = [
  { id: "cocos", name: "Cocos Capital", broker: "cocos", currency: "USD", createdAt: "" },
  { id: "binance", name: "Binance", broker: "binance", currency: "USD", createdAt: "" },
];
const ctx = { accounts, assets: [], defaultAccountId: "cocos", now: "2026-11-07" };

describe("la revisión en casillas", () => {
  it("muestra lo leído con coma decimal y lo vuelve a leer igual", () => {
    const [row] = parseBulk("29/09/2026 compré 387 VSCYO por 612328,81 pesos", ctx);
    const ed = edicionDe(row, "2026-11-07", "cocos");
    expect(ed).toMatchObject({ type: "buy", day: "2026-09-29", symbol: "VSCYO", quantity: "387", currency: "ARS" });
    expect(ed.amount).toBe("612328,81");
    const igual = aplicarEdicion(row, ed);
    expect(igual.blockers).toEqual([]);
    expect(igual.entry?.amount).toBeCloseTo(612328.81, 2);
    expect(igual.entry?.currency).toBe("ARS");
  });

  it("cantidad y precio rehacen el total; el total rehace el precio", () => {
    const [row] = parseBulk("13/03/2025 compré 10 QQQ a 24 usd", ctx);
    let ed = edicionDe(row, "2026-11-07", "cocos");
    ed = cambiar(ed, "price", "108,62");
    expect(ed.amount).toBe("1086,2");
    ed = cambiar(ed, "amount", "1000");
    expect(ed.price).toBe("100");
    const r = aplicarEdicion(row, ed);
    expect(r.entry).toMatchObject({ quantity: 10, price: 100, amount: 1000 });
  });

  it("una línea que no se leyó se completa a mano y queda lista", () => {
    const [row] = parseBulk("esto no es un movimiento", ctx);
    expect(row.include).toBe(false);
    let ed = edicionDe(row, "2026-11-07", "cocos");
    expect(aplicarEdicion(row, ed).blockers.length).toBeGreaterThan(0);
    ed = cambiar(ed, "type", "buy");
    ed = cambiar(ed, "symbol", "ggal");
    ed = cambiar(ed, "quantity", "5");
    ed = cambiar(ed, "price", "7000");
    const r = aplicarEdicion(row, ed);
    expect(r.blockers).toEqual([]);
    expect(r.include).toBe(true);
    expect(r.entry).toMatchObject({ symbol: "GGAL", amount: 35000, accountId: "cocos", dateExplicit: true });
  });

  it("cambiar de moneda no toca los números", () => {
    const [row] = parseBulk("01/10/2026 compré 2 SPY por 50000 pesos", ctx);
    const ed = cambiar(edicionDe(row, "2026-11-07", "cocos"), "currency", "USD");
    expect(aplicarEdicion(row, ed).entry).toMatchObject({ amount: 50000, currency: "USD" });
  });

  it("un cambio de moneda guarda el dólar al que se hizo", () => {
    const [row] = parseBulk("01/10/2026 compré 100 dólares a 1450", ctx);
    const ed = cambiar(edicionDe(row, "2026-11-07", "cocos"), "toAmount", "100");
    const r = aplicarEdicion(row, ed);
    expect(r.entry?.type).toBe("exchange");
    expect(r.entry?.rate).toBeCloseTo((r.entry?.amount ?? 0) / 100, 6);
  });
});
