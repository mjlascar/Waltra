import { describe, expect, it } from "vitest";
import {
  binanceAsset,
  sortOrders,
  parseBinanceOrders,
  parseCsv,
  splitAmount,
  splitPair,
} from "@/lib/parse/binance";

/**
 * Las filas son inventadas, pero el formato es el de la exportacion real:
 * marca de orden de bytes al principio, dos columnas "Time" con el mismo
 * nombre, superindices de las llamadas al pie en los encabezados y el simbolo
 * pegado al numero en las cantidades.
 *
 * Los datos del usuario no entran al repositorio, que es publico.
 */
const HEAD =
  "﻿Time,OrderNo,Pair,Type¹,Side,Order Price,Order Amount,Time,Executed²,Average Price,Trading total³,Status";

const FILAS = [
  // Limit ejecutada al dia siguiente: la fecha que vale es la segunda.
  "2024-02-17 09:00:00,1001,ETHUSDT,Limit,BUY,1915.98,0.033ETH,2024-02-18 11:22:03,0.033ETH,1915.98,63.22734USDT,FILLED",
  // Market contra FDUSD, que tambien es un dolar.
  "2024-03-02 18:41:10,1002,BTCFDUSD,Market,SELL,0,0.001BTC,2024-03-02 18:41:10,0.001BTC,61500.00,61.50000FDUSD,FILLED",
  // Cancelada y vencida: no movieron un peso.
  "2024-04-01 10:00:00,1003,SOLUSDT,Limit,BUY,90.00,1SOL,2024-04-01 10:00:00,0SOL,0,0USDT,CANCELED",
  "2024-04-05 10:00:00,1004,SOLUSDT,Limit,BUY,80.00,1SOL,2024-04-05 10:00:00,0SOL,0,0USDT,EXPIRED",
  // Par contra ETH: no es una operacion en dolares.
  "2024-05-01 12:00:00,1005,SOLETH,Market,BUY,0,1SOL,2024-05-01 12:00:00,1SOL,0.055,0.055ETH,FILLED",
  // Market sin precio promedio: se deduce del total.
  "2024-06-01 12:00:00,1006,SOLUSDT,Market,BUY,0,2SOL,2024-06-01 12:00:00,2SOL,0,300USDT,FILLED",
];

const csv = (filas: string[] = FILAS) => [HEAD, ...filas].join("\n") + "\n";

describe("parseCsv", () => {
  it("saca la marca de orden de bytes", () => {
    expect(parseCsv("﻿a,b\n1,2\n")[0]).toEqual(["a", "b"]);
  });

  it("respeta las comas adentro de comillas", () => {
    expect(parseCsv('a,b\n"1,5",2\n')[1]).toEqual(["1,5", "2"]);
  });

  it("descarta las líneas vacías del final", () => {
    expect(parseCsv("a,b\n1,2\n\n\n")).toHaveLength(2);
  });
});

describe("splitAmount", () => {
  it("separa el símbolo pegado al número", () => {
    expect(splitAmount("0.033ETH")).toEqual({ valor: 0.033, activo: "ETH" });
  });

  it("acepta el número solo", () => {
    expect(splitAmount("1915.98")).toEqual({ valor: 1915.98, activo: undefined });
  });

  it("no inventa un número cuando no hay", () => {
    expect(splitAmount("")).toBeNull();
    expect(splitAmount("--")).toBeNull();
  });
});

describe("splitPair", () => {
  it("elige el sufijo más largo", () => {
    // Al reves, "BTCFDUSD" se leeria como "BTCF" contra "USD".
    expect(splitPair("BTCFDUSD")).toEqual({ base: "BTC", quote: "FDUSD" });
    expect(splitPair("BTCUSDT")).toEqual({ base: "BTC", quote: "USDT" });
  });

  it("rechaza lo que no cotiza contra dólares", () => {
    expect(splitPair("SOLETH")).toBeNull();
    expect(splitPair("USDT")).toBeNull();
  });
});

describe("parseBinanceOrders", () => {
  it("reconoce el archivo por sus columnas", () => {
    const otro = parseBinanceOrders("fecha,monto\n2024-01-01,100\n");
    expect(otro.ok).toBe(false);
    expect(otro.problema).toContain("Binance");
  });

  it("avisa cuando el archivo está vacío", () => {
    expect(parseBinanceOrders("").problema).toContain("vacío");
  });

  it("solo importa las órdenes ejecutadas", () => {
    const { rows, resumen } = parseBinanceOrders(csv());
    expect(resumen.total).toBe(6);
    expect(resumen.listos).toBe(3);
    expect(resumen.omitidos).toBe(2);
    expect(resumen.errores).toBe(1);
    expect(rows.filter((r) => r.skip).map((r) => r.skip)).toEqual(["canceled", "expired"]);
  });

  it("rechaza el par que no cotiza en dólares en vez de registrarlo mal", () => {
    const fila = parseBinanceOrders(csv()).rows.find((r) => r.error);
    expect(fila?.error).toContain("SOLETH");
    expect(fila?.order).toBeUndefined();
  });

  it("toma la hora de ejecución, no la de la orden", () => {
    const [primera] = parseBinanceOrders(csv()).rows;
    // La limit se puso el 17 y se ejecuto el 18.
    expect(primera.order?.day).toBe("2024-02-18");
  });

  it("lee cantidad, precio y total de una compra", () => {
    const orden = parseBinanceOrders(csv()).rows[0].order!;
    expect(orden).toMatchObject({
      type: "buy",
      symbol: "ETH",
      quote: "USDT",
      quantity: 0.033,
      price: 1915.98,
      amount: 63.22734,
    });
  });

  it("deduce el precio del total cuando el promedio vino en cero", () => {
    const orden = parseBinanceOrders(csv()).rows[5].order!;
    expect(orden.price).toBe(150);
    expect(orden.quantity).toBe(2);
  });

  it("le da a cada orden el id de su número de orden", () => {
    // Importar dos veces el mismo archivo reemplaza, no duplica.
    const a = parseBinanceOrders(csv()).rows[0].order!.id;
    const b = parseBinanceOrders(csv()).rows[0].order!.id;
    expect(a).toBe("binance-1001");
    expect(b).toBe(a);
  });

  it("dice cuántos dólares netos consumieron las operaciones", () => {
    // 63.22734 + 300 de compras, menos 61.5 de la venta.
    expect(parseBinanceOrders(csv()).resumen.netoUsd).toBeCloseTo(301.72734, 5);
  });

  it("resume el período y los símbolos tocados", () => {
    const { resumen } = parseBinanceOrders(csv());
    expect(resumen.primerDia).toBe("2024-02-18");
    expect(resumen.ultimoDia).toBe("2024-06-01");
    expect(resumen.simbolos).toEqual(["BTC", "ETH", "SOL"]);
    expect(resumen.compras).toBe(2);
    expect(resumen.ventas).toBe(1);
  });

  it("aguanta un archivo con una sola columna Time", () => {
    // Si Binance deja de repetir el encabezado, la fecha de la orden sirve.
    const solo = [
      HEAD.replace(",Time,Executed²", ",Executed²"),
      "2024-02-17 09:00:00,1001,ETHUSDT,Limit,BUY,1915.98,0.033ETH,0.033ETH,1915.98,63.22734USDT,FILLED",
    ].join("\n");
    const { rows } = parseBinanceOrders(solo);
    expect(rows[0].order?.day).toBe("2024-02-17");
  });

  it("marca la fila sin fecha legible en vez de ponerle hoy", () => {
    const { rows } = parseBinanceOrders(
      csv(["--,1009,ETHUSDT,Limit,BUY,1,1ETH,--,1ETH,1,1USDT,FILLED"]),
    );
    expect(rows[0].error).toContain("fecha");
  });
});

describe("sortOrders", () => {
  it("devuelve las órdenes de la más vieja a la más nueva", () => {
    // El archivo viene al reves, y el orden de carga es el desempate del dia.
    const orden = sortOrders(parseBinanceOrders(csv()).rows).map((o) => o.day);
    expect(orden).toEqual(["2024-02-18", "2024-03-02", "2024-06-01"]);
  });

  it("desempata dos órdenes del mismo día por la hora", () => {
    const rows = parseBinanceOrders(
      csv([
        "2024-07-01 18:00:00,2002,ETHUSDT,Market,SELL,0,1ETH,2024-07-01 18:00:00,1ETH,3000,3000USDT,FILLED",
        "2024-07-01 09:00:00,2001,ETHUSDT,Market,BUY,0,1ETH,2024-07-01 09:00:00,1ETH,2500,2500USDT,FILLED",
      ]),
    ).rows;
    expect(sortOrders(rows).map((o) => o.orderNo)).toEqual(["2001", "2002"]);
  });

  it("deja afuera las omitidas y las que no pudo leer", () => {
    expect(sortOrders(parseBinanceOrders(csv()).rows)).toHaveLength(3);
  });
});

describe("binanceAsset", () => {
  it("usa el catálogo cuando conoce la moneda", () => {
    expect(binanceAsset("BTC", "x")).toMatchObject({
      symbol: "BTC",
      name: "Bitcoin",
      kind: "crypto",
      source: "binance",
      sourceSymbol: "BTCUSDT",
    });
  });

  it("un símbolo nuevo entra como cripto de Binance, no como acción", () => {
    // El respaldo generico apuesta a una accion de Yahoo; lo que sale de un
    // par spot de Binance nunca lo es.
    expect(binanceAsset("wld", "x")).toMatchObject({
      symbol: "WLD",
      kind: "crypto",
      source: "binance",
      sourceSymbol: "WLDUSDT",
      currency: "USD",
    });
  });
});
