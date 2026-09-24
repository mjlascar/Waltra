import { describe, expect, it } from "vitest";
import { computePortfolio, type Portfolio } from "@/lib/engine/portfolio";
import { asset, binance, cocos, series, tx } from "./helpers";
import type { Transaction } from "@/lib/types";

/**
 * Auditoría del modelo contable.
 *
 * Los otros tests del motor prueban cada función; estos prueban que el modelo
 * CIERRA: que la plata no aparece ni desaparece entre los flujos que un
 * usuario hace de verdad. La pregunta que los origina es concreta: si cargo
 * una compra de 300 dólares teniendo 100 en la cuenta, ¿la app se inventa 200
 * de ganancia?
 *
 * Dos identidades tienen que valer SIEMPRE, pase lo que pase:
 *
 *   1. valor = efectivo + invertido
 *   2. ganancia = valor − capital aportado
 *
 * Y una tercera, que es la que de verdad audita el modelo: la ganancia tiene
 * que poder descomponerse en sus causas (lo que subieron las posiciones, lo
 * que se realizó al vender, lo cobrado, lo pagado de comisiones). Si cierra,
 * no hay plata saliendo de la nada.
 */

const assets = [
  asset("qqq"),
  asset("spy"),
  asset("btc", { kind: "crypto", source: "binance", precision: 8 }),
];

interface Escenario {
  transactions: Transaction[];
  /** Precio de cada activo al día de corte. */
  precios?: Record<string, number>;
  asOf?: string;
  fxRates?: { date: string; arsPerUsd: number }[];
}

function correr({ transactions, precios = {}, asOf = "2024-03-01", fxRates = [] }: Escenario) {
  return computePortfolio({
    transactions,
    assets,
    accounts: [cocos, binance],
    // Serie plana desde el primer día, para que la valuación histórica exista.
    priceSeries: Object.entries(precios).map(([id, precio]) =>
      series(id, "2024-01-01", 120, precio),
    ),
    quotes: Object.entries(precios).map(([assetId, price]) => ({
      assetId,
      price,
      currency: "USD" as const,
      at: asOf,
      source: "yahoo" as const,
    })),
    fxRates,
    asOf,
  });
}

/** Las dos identidades que no pueden fallar nunca. */
function verificarIdentidades(p: Portfolio) {
  expect(p.totalValueUsd).toBeCloseTo(p.cashUsd + p.investedUsd, 6);
  expect(p.totalPnlUsd).toBeCloseTo(p.totalValueUsd - p.netContributedUsd, 6);
}

/**
 * La ganancia, descompuesta en sus causas.
 *
 * Las comisiones de compra y de venta NO entran acá: ya están adentro del
 * costo de la posición y del resultado realizado. Restarlas otra vez sería
 * contarlas dos veces. Las que faltan son las sueltas y las de los
 * movimientos de capital.
 */
function ganandoPorCausas(p: Portfolio, comisionesSueltas: number) {
  return p.unrealizedUsd + p.realizedUsd + p.incomeUsd - comisionesSueltas;
}

describe("un depósito es capital y nada más", () => {
  it("no genera ganancia", () => {
    const p = correr({ transactions: [tx("deposit", "2024-01-01", { amount: 1000 })] });
    verificarIdentidades(p);
    expect(p.netContributedUsd).toBeCloseTo(1000);
    expect(p.totalValueUsd).toBeCloseTo(1000);
    expect(p.totalPnlUsd).toBeCloseTo(0);
    expect(p.cashUsd).toBeCloseTo(1000);
  });

  it("un retiro baja el capital sin tocar la ganancia", () => {
    const p = correr({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 1000 }),
        tx("withdraw", "2024-02-01", { amount: 400 }),
      ],
    });
    verificarIdentidades(p);
    expect(p.netContributedUsd).toBeCloseTo(600);
    expect(p.totalValueUsd).toBeCloseTo(600);
    expect(p.totalPnlUsd).toBeCloseTo(0);
  });
});

describe("comprar no cambia el patrimonio", () => {
  it("convierte efectivo en activo, sin ganancia ni capital nuevo", () => {
    const p = correr({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 1000 }),
        tx("buy", "2024-01-02", { amount: 600, assetId: "qqq", quantity: 2, price: 300 }),
      ],
      precios: { qqq: 300 },
    });
    verificarIdentidades(p);
    expect(p.cashUsd).toBeCloseTo(400);
    expect(p.investedUsd).toBeCloseTo(600);
    expect(p.totalValueUsd).toBeCloseTo(1000);
    expect(p.netContributedUsd).toBeCloseTo(1000);
    expect(p.totalPnlUsd).toBeCloseTo(0);
  });

  /**
   * El caso que motiva toda esta auditoría: comprar más de lo que hay.
   *
   * La cuenta cierra sola porque el efectivo se va a negativo, y ese negativo
   * cancela exactamente el activo de más. No hay ganancia fantasma. Lo que sí
   * pasa es que la cartera queda describiendo algo imposible, y eso hay que
   * DECIRLO, no taparlo: de ahí el aviso al cargar y en el detalle de cuenta.
   */
  it("comprar 300 teniendo 100 no inventa 200 de ganancia", () => {
    const p = correr({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 100 }),
        tx("buy", "2024-01-02", { amount: 300, assetId: "qqq", quantity: 1, price: 300 }),
      ],
      precios: { qqq: 300 },
    });
    verificarIdentidades(p);
    expect(p.cashUsd).toBeCloseTo(-200);
    expect(p.investedUsd).toBeCloseTo(300);
    expect(p.totalValueUsd).toBeCloseTo(100);
    expect(p.netContributedUsd).toBeCloseTo(100);
    // Lo único que importa: la ganancia sigue siendo cero.
    expect(p.totalPnlUsd).toBeCloseTo(0);
  });

  it("y si después sube, la ganancia es solo la suba", () => {
    const p = correr({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 100 }),
        tx("buy", "2024-01-02", { amount: 300, assetId: "qqq", quantity: 1, price: 300 }),
      ],
      precios: { qqq: 330 },
    });
    verificarIdentidades(p);
    // Subió 30, no 230.
    expect(p.totalPnlUsd).toBeCloseTo(30);
    expect(p.unrealizedUsd).toBeCloseTo(30);
  });

  it("la comisión de compra entra al costo y se siente como pérdida", () => {
    const p = correr({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 1000 }),
        tx("buy", "2024-01-02", { amount: 600, assetId: "qqq", quantity: 2, price: 300, fee: 5 }),
      ],
      precios: { qqq: 300 },
    });
    verificarIdentidades(p);
    expect(p.cashUsd).toBeCloseTo(395);
    expect(p.totalValueUsd).toBeCloseTo(995);
    expect(p.totalPnlUsd).toBeCloseTo(-5);
    expect(p.unrealizedUsd).toBeCloseTo(-5);
  });
});

describe("vender realiza, no crea", () => {
  it("vender al mismo precio no mueve el patrimonio", () => {
    const p = correr({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 1000 }),
        tx("buy", "2024-01-02", { amount: 600, assetId: "qqq", quantity: 2, price: 300 }),
        tx("sell", "2024-02-01", { amount: 600, assetId: "qqq", quantity: 2, price: 300 }),
      ],
      precios: { qqq: 300 },
    });
    verificarIdentidades(p);
    expect(p.totalValueUsd).toBeCloseTo(1000);
    expect(p.totalPnlUsd).toBeCloseTo(0);
    expect(p.realizedUsd).toBeCloseTo(0);
    expect(p.positions).toHaveLength(0);
  });

  it("vender más caro realiza la diferencia y nada más", () => {
    const p = correr({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 1000 }),
        tx("buy", "2024-01-02", { amount: 600, assetId: "qqq", quantity: 2, price: 300 }),
        tx("sell", "2024-02-01", { amount: 800, assetId: "qqq", quantity: 2, price: 400 }),
      ],
      precios: { qqq: 400 },
    });
    verificarIdentidades(p);
    expect(p.realizedUsd).toBeCloseTo(200);
    expect(p.totalPnlUsd).toBeCloseTo(200);
    expect(p.netContributedUsd).toBeCloseTo(1000);
    expect(ganandoPorCausas(p, 0)).toBeCloseTo(p.totalPnlUsd, 6);
  });

  it("vender la mitad deja el costo promedio intacto", () => {
    const p = correr({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 1000 }),
        tx("buy", "2024-01-02", { amount: 600, assetId: "qqq", quantity: 2, price: 300 }),
        tx("sell", "2024-02-01", { amount: 400, assetId: "qqq", quantity: 1, price: 400 }),
      ],
      precios: { qqq: 400 },
    });
    verificarIdentidades(p);
    expect(p.realizedUsd).toBeCloseTo(100);
    expect(p.unrealizedUsd).toBeCloseTo(100);
    expect(p.totalPnlUsd).toBeCloseTo(200);
    expect(p.positions[0].quantity).toBeCloseTo(1);
    expect(p.positions[0].avgCostUsd).toBeCloseTo(300);
  });
});

describe("mover plata entre cuentas propias no es capital nuevo", () => {
  it("el capital y el valor no se mueven", () => {
    const p = correr({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 1000, accountId: "cocos" }),
        tx("transfer", "2024-01-05", {
          amount: 400,
          accountId: "cocos",
          counterAccountId: "binance",
        }),
      ],
    });
    verificarIdentidades(p);
    expect(p.netContributedUsd).toBeCloseTo(1000);
    expect(p.totalValueUsd).toBeCloseTo(1000);
    expect(p.totalPnlUsd).toBeCloseTo(0);
  });

  it("cada cuenta muestra lo suyo sin inventar ganancia en ninguna", () => {
    const p = correr({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 1000, accountId: "cocos" }),
        tx("transfer", "2024-01-05", {
          amount: 400,
          accountId: "cocos",
          counterAccountId: "binance",
        }),
      ],
    });
    const porCuenta = Object.fromEntries(p.accountViews.map((v) => [v.accountId, v]));
    expect(porCuenta.cocos.valueUsd).toBeCloseTo(600);
    expect(porCuenta.binance.valueUsd).toBeCloseTo(400);
    // El capital "viaja" con la plata: si no, Binance mostraría 400 de
    // ganancia salida de la nada y Cocos 400 de pérdida.
    expect(porCuenta.binance.netContributedUsd).toBeCloseTo(400);
    expect(porCuenta.cocos.pnlUsd).toBeCloseTo(0);
    expect(porCuenta.binance.pnlUsd).toBeCloseTo(0);
  });
});

describe("rentas y costos", () => {
  it("un dividendo es ganancia, no capital", () => {
    const p = correr({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 1000 }),
        tx("buy", "2024-01-02", { amount: 600, assetId: "qqq", quantity: 2, price: 300 }),
        tx("dividend", "2024-02-01", { amount: 12, assetId: "qqq" }),
      ],
      precios: { qqq: 300 },
    });
    verificarIdentidades(p);
    expect(p.netContributedUsd).toBeCloseTo(1000);
    expect(p.totalPnlUsd).toBeCloseTo(12);
    expect(p.incomeUsd).toBeCloseTo(12);
    expect(ganandoPorCausas(p, 0)).toBeCloseTo(p.totalPnlUsd, 6);
  });

  it("un interés de cuenta remunerada también", () => {
    const p = correr({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 1000 }),
        tx("interest", "2024-02-01", { amount: 7 }),
      ],
    });
    verificarIdentidades(p);
    expect(p.netContributedUsd).toBeCloseTo(1000);
    expect(p.totalPnlUsd).toBeCloseTo(7);
  });

  it("una comisión suelta es pérdida, no retiro de capital", () => {
    const p = correr({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 1000 }),
        tx("fee", "2024-02-01", { amount: 9 }),
      ],
    });
    verificarIdentidades(p);
    expect(p.netContributedUsd).toBeCloseTo(1000);
    expect(p.totalValueUsd).toBeCloseTo(991);
    expect(p.totalPnlUsd).toBeCloseTo(-9);
    expect(ganandoPorCausas(p, 9)).toBeCloseTo(p.totalPnlUsd, 6);
  });
});

describe("la historia entera cierra", () => {
  /** Dos años de uso mezclando todo lo que la app sabe hacer. */
  const vida: Transaction[] = [
    tx("deposit", "2024-01-01", { amount: 1000, accountId: "cocos" }),
    tx("buy", "2024-01-03", { amount: 600, assetId: "qqq", quantity: 2, price: 300, fee: 2 }),
    tx("transfer", "2024-01-10", {
      amount: 300,
      accountId: "cocos",
      counterAccountId: "binance",
    }),
    tx("buy", "2024-01-11", {
      amount: 250,
      assetId: "btc",
      quantity: 0.005,
      price: 50000,
      accountId: "binance",
    }),
    tx("dividend", "2024-02-01", { amount: 8, assetId: "qqq" }),
    tx("deposit", "2024-02-05", { amount: 500, accountId: "cocos" }),
    tx("buy", "2024-02-06", { amount: 400, assetId: "spy", quantity: 1, price: 400 }),
    tx("sell", "2024-02-20", { amount: 350, assetId: "qqq", quantity: 1, price: 350, fee: 1 }),
    tx("fee", "2024-02-21", { amount: 3 }),
    tx("interest", "2024-02-25", { amount: 4 }),
    tx("withdraw", "2024-02-28", { amount: 200, accountId: "cocos" }),
  ];

  const precios = { qqq: 360, spy: 420, btc: 56000 };

  it("las dos identidades valen", () => {
    verificarIdentidades(correr({ transactions: vida, precios }));
  });

  it("la ganancia se explica entera por sus causas", () => {
    const p = correr({ transactions: vida, precios });
    // Sueltas: la comisión de 3. Las de compra y venta ya están adentro del
    // costo y del realizado.
    expect(ganandoPorCausas(p, 3)).toBeCloseTo(p.totalPnlUsd, 6);
  });

  it("el capital aportado es exactamente ingresos menos retiros", () => {
    const p = correr({ transactions: vida, precios });
    expect(p.depositedUsd).toBeCloseTo(1500);
    expect(p.withdrawnUsd).toBeCloseTo(200);
    expect(p.netContributedUsd).toBeCloseTo(1300);
  });

  it("el valor de la serie diaria termina donde termina la cartera", () => {
    const p = correr({ transactions: vida, precios });
    // El último punto usa el cierre guardado y el total usa la cotización en
    // vivo; acá son el mismo número, así que tienen que coincidir.
    expect(p.daily[p.daily.length - 1].nav).toBeCloseTo(p.totalValueUsd, 6);
  });

  it("la suma de las cuentas es la cartera", () => {
    const p = correr({ transactions: vida, precios });
    const suma = p.accountViews.reduce((s, v) => s + v.valueUsd, 0);
    expect(suma).toBeCloseTo(p.totalValueUsd, 6);
    const capital = p.accountViews.reduce((s, v) => s + v.netContributedUsd, 0);
    expect(capital).toBeCloseTo(p.netContributedUsd, 6);
  });

  it("cerrar todo deja la cartera en cero y la ganancia intacta", () => {
    const cierre: Transaction[] = [
      ...vida,
      tx("sell", "2024-02-29", { amount: 360, assetId: "qqq", quantity: 1, price: 360 }),
      tx("sell", "2024-02-29", { amount: 420, assetId: "spy", quantity: 1, price: 420 }),
      tx("sell", "2024-02-29", {
        amount: 280,
        assetId: "btc",
        quantity: 0.005,
        price: 56000,
        accountId: "binance",
      }),
    ];
    const p = correr({ transactions: cierre, precios });
    verificarIdentidades(p);
    expect(p.positions).toHaveLength(0);
    expect(p.investedUsd).toBeCloseTo(0);
    // Con todo vendido no queda nada sin realizar: la ganancia es la suma de
    // lo realizado y lo cobrado, menos la comisión suelta.
    expect(p.unrealizedUsd).toBeCloseTo(0);
    expect(p.totalPnlUsd).toBeCloseTo(p.realizedUsd + p.incomeUsd - 3, 6);
  });
});

describe("el rendimiento no se ensucia con los aportes", () => {
  it("un depósito no mueve el TWR", () => {
    const sinAporte = correr({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 1000 }),
        tx("buy", "2024-01-01", { amount: 1000, assetId: "qqq", quantity: 10, price: 100 }),
      ],
      precios: { qqq: 110 },
    });
    const conAporte = correr({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 1000 }),
        tx("buy", "2024-01-01", { amount: 1000, assetId: "qqq", quantity: 10, price: 100 }),
        // Entra plata a mitad de camino y se queda quieta en efectivo.
        tx("deposit", "2024-02-01", { amount: 5000 }),
      ],
      precios: { qqq: 110 },
    });
    // La ganancia en plata es la misma; el valor total no.
    expect(conAporte.totalValueUsd).toBeCloseTo(sinAporte.totalValueUsd + 5000, 6);
    expect(conAporte.totalPnlUsd).toBeCloseTo(sinAporte.totalPnlUsd, 6);
    // Y el rendimiento simple sí baja, porque ahora hay plata sin trabajar:
    // son dos preguntas distintas y las dos están bien.
    expect(conAporte.simpleReturn!).toBeLessThan(sinAporte.simpleReturn!);
  });
});

describe("pesos", () => {
  it("un ingreso en pesos se cuenta al dólar del día", () => {
    const p = correr({
      transactions: [tx("deposit", "2024-01-01", { amount: 100_000, currency: "ARS" })],
      fxRates: [{ date: "2024-01-01", arsPerUsd: 1000 }],
    });
    verificarIdentidades(p);
    expect(p.netContributedUsd).toBeCloseTo(100);
    expect(p.totalValueUsd).toBeCloseTo(100);
    expect(p.totalPnlUsd).toBeCloseTo(0);
  });

  it("el tipo de cambio de la operación le gana al del día", () => {
    const p = correr({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 100_000, currency: "ARS", fxRate: 1250 }),
      ],
      fxRates: [{ date: "2024-01-01", arsPerUsd: 1000 }],
    });
    expect(p.netContributedUsd).toBeCloseTo(80);
  });

  it("sin dólar no se cuenta como si fuera uno a uno", () => {
    const p = correr({
      transactions: [tx("deposit", "2024-01-01", { amount: 100_000, currency: "ARS" })],
      fxRates: [],
    });
    // Preferimos no contarlo y decirlo, antes que contar 100.000 dólares.
    expect(p.fxMissing).toBe(true);
    expect(p.netContributedUsd).toBeCloseTo(0);
  });
});

describe("comprar dólares no es capital ni ganancia", () => {
  const fxRates = [{ date: "2024-01-01", arsPerUsd: 1000 }];

  it("al dólar del día, el patrimonio no se mueve", () => {
    const p = correr({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 200_000, currency: "ARS" }),
        tx("exchange", "2024-01-02", {
          amount: 100_000,
          currency: "ARS",
          toAmount: 100,
          toCurrency: "USD",
        }),
      ],
      fxRates,
    });
    verificarIdentidades(p);
    expect(p.netContributedUsd).toBeCloseTo(200);
    expect(p.totalValueUsd).toBeCloseTo(200);
    expect(p.totalPnlUsd).toBeCloseTo(0);
  });

  it("los pesos salen y los dólares entran, en la misma cuenta", () => {
    const p = correr({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 200_000, currency: "ARS" }),
        tx("exchange", "2024-01-02", {
          amount: 100_000,
          currency: "ARS",
          toAmount: 100,
          toCurrency: "USD",
        }),
      ],
      fxRates,
    });
    const cocos = p.accountViews.find((v) => v.accountId === "cocos")!;
    expect(cocos.cash.ARS).toBeCloseTo(100_000);
    expect(cocos.cash.USD).toBeCloseTo(100);
  });

  it("pagarlo más caro que el dólar del día se ve como lo que es", () => {
    // 105.000 pesos por 100 dólares con el dólar a 1.000: se pagaron 5 de más.
    const p = correr({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 200_000, currency: "ARS" }),
        tx("exchange", "2024-01-02", {
          amount: 105_000,
          currency: "ARS",
          toAmount: 100,
          toCurrency: "USD",
        }),
      ],
      fxRates,
    });
    verificarIdentidades(p);
    expect(p.netContributedUsd).toBeCloseTo(200);
    expect(p.totalPnlUsd).toBeCloseTo(-5);
  });

  it("vender dólares es el mismo movimiento al revés", () => {
    const p = correr({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 100 }),
        tx("exchange", "2024-01-02", {
          amount: 100,
          currency: "USD",
          toAmount: 100_000,
          toCurrency: "ARS",
        }),
      ],
      fxRates,
    });
    verificarIdentidades(p);
    expect(p.totalPnlUsd).toBeCloseTo(0);
    const cocos = p.accountViews.find((v) => v.accountId === "cocos")!;
    expect(cocos.cash.USD ?? 0).toBeCloseTo(0);
    expect(cocos.cash.ARS).toBeCloseTo(100_000);
  });

  it("no mueve el rendimiento", () => {
    const p = correr({
      transactions: [
        tx("deposit", "2024-01-01", { amount: 200_000, currency: "ARS" }),
        tx("exchange", "2024-01-02", {
          amount: 100_000,
          currency: "ARS",
          toAmount: 100,
          toCurrency: "USD",
        }),
      ],
      fxRates,
    });
    expect(p.metrics.twrCumulative).toBeCloseTo(0, 6);
  });
});
