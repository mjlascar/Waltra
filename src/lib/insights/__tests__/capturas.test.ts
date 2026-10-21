import { describe, expect, it } from "vitest";
import { CAPTURAS_SYSTEM, EJEMPLOS, LECTURA_DE_PRUEBA, limpiarLineas, pedidoExterno } from "../capturas";
import { parseBulk } from "@/lib/parse/bulk";
import { cortes } from "@/lib/capturas-imagen";
import type { Account } from "@/lib/types";

const accounts: Account[] = [
  { id: "cocos", name: "Cocos Capital", broker: "cocos", currency: "USD", createdAt: "" },
  { id: "binance", name: "Binance", broker: "binance", currency: "USD", createdAt: "" },
];

describe("el formato que se le pide al modelo", () => {
  it("cada ejemplo del pedido lo entiende el parser de la app, en la cuenta elegida", () => {
    const rows = parseBulk(EJEMPLOS.join("\n"), { accounts, assets: [], defaultAccountId: "cocos", now: "2026-10-21" });
    expect(rows).toHaveLength(EJEMPLOS.length);
    for (const row of rows) {
      expect(row.blockers, row.raw).toEqual([]);
      expect(row.entry?.dateExplicit, row.raw).toBe(true);
      expect(row.entry?.accountId, row.raw).toBe("cocos");
    }
    expect(rows.map((r) => r.entry?.type)).toEqual(["buy", "sell", "exchange", "deposit", "withdraw", "dividend", "interest"]);
    // "por" es el total: 9 SPY por 456.345 pesos no es 9 × 456.345.
    expect(rows[0].entry).toMatchObject({ symbol: "SPY", quantity: 9, amount: 456345, currency: "ARS" });
    expect(rows[2].entry).toMatchObject({ amount: 145000, currency: "ARS", toAmount: 100, toCurrency: "USD" });
  });

  it("los ejemplos van en el pedido, y el pedido externo es el mismo texto", () => {
    for (const e of EJEMPLOS) expect(CAPTURAS_SYSTEM).toContain(e);
    expect(pedidoExterno("2026-10-21")).toContain(CAPTURAS_SYSTEM);
    expect(pedidoExterno("2026-10-21")).toContain("Hoy es 2026-10-21");
  });

  it("lo que el modelo no pudo leer queda afuera de la carga, pero a la vista", () => {
    const rows = parseBulk(LECTURA_DE_PRUEBA, { accounts, assets: [], defaultAccountId: "cocos", now: "2026-10-21" });
    expect(rows).toHaveLength(2);
    expect(LECTURA_DE_PRUEBA).toMatch(/^# /m);
  });
});

describe("la respuesta del modelo", () => {
  it("se limpia de bloques de codigo y viñetas", () => {
    const texto = "```\n- 15/10/2026 compré 9 SPY por 456345 pesos\n• 18/10/2026 ingresé 500 dólares\n```";
    expect(limpiarLineas(texto)).toBe("15/10/2026 compré 9 SPY por 456345 pesos\n18/10/2026 ingresé 500 dólares");
  });
});

describe("las capturas largas", () => {
  it("una captura casi cuadrada va entera", () => {
    expect(cortes(1080, 1100)).toEqual([{ y: 0, alto: 1100 }]);
  });

  it("una de telefono se parte en pedazos que se pisan un poco y la cubren entera", () => {
    const partes = cortes(1080, 2280);
    expect(partes.length).toBe(2);
    expect(partes[0].y).toBe(0);
    expect(partes[1].y).toBeLessThan(partes[0].alto);
    const ultima = partes[partes.length - 1];
    expect(ultima.y + ultima.alto).toBe(2280);
  });

  it("una angosta no se parte", () => {
    expect(cortes(80, 3000)).toEqual([{ y: 0, alto: 3000 }]);
  });

  it("lo que se repite entre pedazos alcanza para una fila entera", () => {
    const [a, b] = cortes(1080, 2280);
    expect(a.y + a.alto - b.y).toBeGreaterThanOrEqual(250);
  });

  it("una muy larga, en varios", () => {
    const partes = cortes(1080, 6000);
    expect(partes.length).toBeGreaterThan(4);
    for (let i = 1; i < partes.length; i++) {
      // Cada pedazo arranca antes de que termine el anterior: ninguna fila queda cortada.
      expect(partes[i].y).toBeLessThan(partes[i - 1].y + partes[i - 1].alto);
    }
    expect(partes[partes.length - 1].y + partes[partes.length - 1].alto).toBe(6000);
  });
});
