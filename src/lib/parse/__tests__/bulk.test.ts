import { describe, expect, it } from "vitest";
import { parseBulk, summarize } from "@/lib/parse/bulk";
import type { Account, Asset } from "@/lib/types";

const accounts: Account[] = [
  { id: "cocos", name: "Cocos Capital", broker: "cocos", currency: "USD", createdAt: "" },
  { id: "binance", name: "Binance", broker: "binance", currency: "USD", createdAt: "" },
];
const assets: Asset[] = [];
const ctx = { accounts, assets, defaultAccountId: "cocos", now: "2026-09-21" };

/** Un pegado como el que saldría de un bloc de notas real. */
const NOTAS = `
# mis inversiones

12/03/2025 pasé 500 dólares a cocos
13/03/2025 compré 300 de QQQ a 430
# sección nueva
20/04/2025 pasé 200 a binance
21/04/2025 compré 0.002 BTC a 84000

15/06/2025 vendí 0.3 QQQ a 470
esto no es un movimiento
10/08/2025 dividendo 4,5 de QQQ
`;

describe("parseBulk", () => {
  it("lee un pegado con comentarios y líneas vacías", () => {
    const rows = parseBulk(NOTAS, ctx);
    // Se descartan vacias y comentarios, quedan las 7 lineas con contenido.
    expect(rows).toHaveLength(7);
    expect(rows.filter((r) => r.include)).toHaveLength(6);
  });

  it("respeta las fechas de cada línea", () => {
    const rows = parseBulk(NOTAS, ctx).filter((r) => r.include);
    expect(rows[0].entry!.day).toBe("2025-03-12");
    expect(rows[0].entry!.type).toBe("deposit");
    expect(rows[1].entry!.day).toBe("2025-03-13");
    expect(rows[1].entry!.symbol).toBe("QQQ");
    expect(rows[2].entry!.accountId).toBe("binance");
    expect(rows[3].entry!.symbol).toBe("BTC");
    expect(rows[3].entry!.quantity).toBeCloseTo(0.002);
  });

  it("marca la línea que no es un movimiento en vez de inventarla", () => {
    const rows = parseBulk(NOTAS, ctx);
    const mala = rows.find((r) => r.raw.startsWith("esto no es"))!;
    expect(mala.include).toBe(false);
    expect(mala.blockers).toContain("Sin monto.");
  });

  it("conserva el número de línea original para poder señalarla", () => {
    const rows = parseBulk("uno\ndos 100 a cocos", ctx);
    expect(rows[0].index).toBe(1);
    expect(rows[1].index).toBe(2);
  });

  it("una compra sin activo no se puede guardar", () => {
    const rows = parseBulk("compré 100 a 50", ctx);
    expect(rows[0].include).toBe(false);
    expect(rows[0].blockers).toContain("Sin activo.");
  });

  it("una transferencia sin destino no se puede guardar", () => {
    const [row] = parseBulk("pasé 100 de cocos a ninguna parte", ctx);
    // Se lee como retiro o deposito, pero nunca como una transferencia a medias.
    expect(row.entry!.type).not.toBe("transfer");
  });

  it("texto vacío no produce filas", () => {
    expect(parseBulk("\n\n   \n# solo comentarios", ctx)).toEqual([]);
  });
});

describe("summarize", () => {
  it("resume lo que se va a guardar", () => {
    const rows = parseBulk(NOTAS, ctx);
    const s = summarize(rows);
    expect(s.total).toBe(7);
    expect(s.listos).toBe(6);
    expect(s.conProblemas).toBe(1);
    expect(s.sinFecha).toBe(0);
    expect(s.primerDia).toBe("2025-03-12");
    expect(s.ultimoDia).toBe("2025-08-10");
  });

  it("cuenta las líneas sin fecha explícita", () => {
    const rows = parseBulk("pasé 100 a cocos\n12/03/2025 pasé 200 a cocos", ctx);
    expect(summarize(rows).sinFecha).toBe(1);
  });
});

describe("la cuenta se arrastra entre líneas", () => {
  it("una compra hereda la cuenta de la línea anterior", () => {
    const rows = parseBulk(
      ["pasé 500 a binance", "compré 200 de BTC a 90000", "pasé 300 a cocos", "compré 100 de QQQ a 500"].join("\n"),
      ctx,
    );
    expect(rows[0].entry!.accountId).toBe("binance");
    expect(rows[1].entry!.accountId).toBe("binance");
    expect(rows[2].entry!.accountId).toBe("cocos");
    expect(rows[3].entry!.accountId).toBe("cocos");
  });

  it("una línea que nombra su cuenta manda sobre la heredada", () => {
    const rows = parseBulk(
      ["pasé 500 a binance", "compré 100 de QQQ a 500 en cocos", "compré 50 de SPY a 600"].join("\n"),
      ctx,
    );
    expect(rows[1].entry!.accountId).toBe("cocos");
    // Y a partir de ahi, la que se arrastra es cocos.
    expect(rows[2].entry!.accountId).toBe("cocos");
  });

  it("después de una transferencia se sigue con la cuenta destino", () => {
    const rows = parseBulk(
      ["pasé 100 de cocos a binance", "compré 50 de BTC a 90000"].join("\n"),
      ctx,
    );
    expect(rows[0].entry!.type).toBe("transfer");
    expect(rows[1].entry!.accountId).toBe("binance");
  });

  it("la primera línea sin cuenta usa la predeterminada", () => {
    const rows = parseBulk("compré 100 de QQQ a 500", ctx);
    expect(rows[0].entry!.accountId).toBe("cocos");
    expect(rows[0].entry!.accountExplicit).toBe(false);
  });
});
