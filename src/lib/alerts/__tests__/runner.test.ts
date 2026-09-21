import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

/**
 * El vigia de precios corre en el telefono, en un motor JavaScript sin
 * modulos ni empaquetador, asi que no se puede importar. Se carga tal cual en
 * un contexto con las funciones globales que Android le da, y se le revisan
 * las decisiones: es el mismo archivo que termina adentro del APK, no una
 * copia en TypeScript que podria irse separando sin que nadie lo note.
 */

interface Aviso {
  id: number;
  title: string;
  body: string;
  group: string;
}

interface Estado {
  day: string;
  notified: Record<string, number>;
  portfolio?: number;
  digestDay?: string;
  [key: string]: unknown;
}

interface Runner {
  decidir: (
    plan: unknown,
    precios: unknown,
    estado: Partial<Estado>,
    ahora: Date,
  ) => { avisos: Aviso[]; estado: Estado };
  enSilencio: (quiet: [number, number] | null, hora: number) => boolean;
  numero: (value: number, decimals: number) => string;
  dinero: (value: number) => string;
  porcentaje: (value: number) => string;
  localDay: (date: Date) => string;
  notifId: (prefijo: string, texto: string) => number;
}

const FUENTE = readFileSync("public/runners/alerts.js", "utf8");

function cargar(globals: Record<string, unknown> = {}) {
  const listeners: Record<string, (resolve: () => void, reject: (e: unknown) => void) => void> = {};
  const sandbox: Record<string, unknown> = {
    addEventListener: (name: string, fn: (r: () => void, j: (e: unknown) => void) => void) => {
      listeners[name] = fn;
    },
    console: { log: () => {}, error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
    // Un contexto de vm arranca solo con lo que define el lenguaje. Los
    // temporizadores y fetch los pone el anfitrion, igual que en el motor de
    // Android: si no se los damos, el entorno de prueba miente.
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    ...globals,
  };
  const ctx = createContext(sandbox);
  runInContext(FUENTE, ctx);
  return { runner: ctx as unknown as Runner, listeners, sandbox };
}

const { runner } = cargar();

function plan(over: Record<string, unknown> = {}) {
  return {
    v: 1,
    at: "2026-09-21T12:00:00.000Z",
    quiet: null,
    digestHour: null,
    portfolioPct: 0,
    cashUsd: 0,
    arsPerUsd: 1000,
    assets: [{ sym: "BTC", src: "binance", ss: "BTCUSDT", cur: "USD", qty: 1, pct: 5 }],
    ...over,
  };
}

const MEDIODIA = new Date(2026, 8, 21, 12, 0, 0);

describe("formato sin Intl", () => {
  it("usa el punto de miles y la coma decimal", () => {
    expect(runner.numero(1234.5, 1)).toBe("1.234,5");
    expect(runner.numero(999, 0)).toBe("999");
    expect(runner.numero(1234567.89, 2)).toBe("1.234.567,89");
    expect(runner.numero(-1500, 0)).toBe("-1.500");
  });

  it("achica los decimales cuando el numero es grande", () => {
    expect(runner.dinero(95000)).toBe("US$ 95.000");
    expect(runner.dinero(12.5)).toBe("US$ 12,50");
  });

  it("los porcentajes llevan signo siempre", () => {
    expect(runner.porcentaje(5.24)).toBe("+5,2%");
    expect(runner.porcentaje(-3)).toBe("-3,0%");
  });

  it("el dia sale del reloj local, no de UTC", () => {
    // A las 21 en Argentina, toISOString ya dice mañana.
    expect(runner.localDay(new Date(2026, 8, 21, 21, 30))).toBe("2026-09-21");
  });

  it("los ids de notificacion entran en un entero de 32 bits", () => {
    const id = runner.notifId("activo", "BTC");
    expect(Number.isInteger(id)).toBe(true);
    expect(id).toBeGreaterThan(0);
    expect(id).toBeLessThan(2147483647);
    expect(runner.notifId("activo", "BTC")).toBe(id);
    expect(runner.notifId("activo", "ETH")).not.toBe(id);
  });
});

describe("franja sin molestar", () => {
  it("cruza la medianoche", () => {
    expect(runner.enSilencio([23, 8], 23)).toBe(true);
    expect(runner.enSilencio([23, 8], 3)).toBe(true);
    expect(runner.enSilencio([23, 8], 7)).toBe(true);
    expect(runner.enSilencio([23, 8], 8)).toBe(false);
    expect(runner.enSilencio([23, 8], 15)).toBe(false);
  });

  it("y tambien una franja dentro del mismo dia", () => {
    expect(runner.enSilencio([13, 15], 14)).toBe(true);
    expect(runner.enSilencio([13, 15], 16)).toBe(false);
  });

  it("sin franja no silencia nada", () => {
    expect(runner.enSilencio(null, 3)).toBe(false);
  });
});

describe("avisos por activo", () => {
  it("avisa cuando pasa el umbral", () => {
    const { avisos } = runner.decidir(
      plan(),
      { "binance|BTCUSDT": { price: 95000, changePct: -6.2 } },
      {},
      MEDIODIA,
    );
    expect(avisos).toHaveLength(1);
    expect(avisos[0].title).toBe("BTC -6,2%");
    expect(avisos[0].body).toContain("Bajó 6,2%");
    expect(avisos[0].body).toContain("US$ 95.000");
  });

  it("no avisa por debajo del umbral", () => {
    const { avisos } = runner.decidir(
      plan(),
      { "binance|BTCUSDT": { price: 95000, changePct: 3 } },
      {},
      MEDIODIA,
    );
    expect(avisos).toHaveLength(0);
  });

  it("no repite el mismo aviso en la corrida siguiente", () => {
    const precios = { "binance|BTCUSDT": { price: 95000, changePct: -6.2 } };
    const primera = runner.decidir(plan(), precios, {}, MEDIODIA);
    const segunda = runner.decidir(plan(), precios, primera.estado, MEDIODIA);
    expect(segunda.avisos).toHaveLength(0);
  });

  it("pero si vuelve a avisar cuando se mueve otro escalon entero", () => {
    const primera = runner.decidir(
      plan(),
      { "binance|BTCUSDT": { price: 95000, changePct: -6 } },
      {},
      MEDIODIA,
    );
    const segunda = runner.decidir(
      plan(),
      { "binance|BTCUSDT": { price: 89000, changePct: -12 } },
      primera.estado,
      MEDIODIA,
    );
    expect(segunda.avisos).toHaveLength(1);
    expect(segunda.avisos[0].title).toBe("BTC -12,0%");
  });

  it("empieza de cero al dia siguiente", () => {
    const precios = { "binance|BTCUSDT": { price: 95000, changePct: -6.2 } };
    const primera = runner.decidir(plan(), precios, {}, MEDIODIA);
    const otroDia = runner.decidir(
      plan(),
      precios,
      primera.estado,
      new Date(2026, 8, 22, 12, 0, 0),
    );
    expect(otroDia.avisos).toHaveLength(1);
  });

  it("un umbral en cero apaga las alertas de ese activo", () => {
    const { avisos } = runner.decidir(
      plan({ assets: [{ sym: "BTC", src: "binance", ss: "BTCUSDT", cur: "USD", qty: 1, pct: 0 }] }),
      { "binance|BTCUSDT": { price: 95000, changePct: -30 } },
      {},
      MEDIODIA,
    );
    expect(avisos).toHaveLength(0);
  });

  it("en silencio no avisa, y el aviso sale cuando la franja termina", () => {
    const precios = { "binance|BTCUSDT": { price: 95000, changePct: -6.2 } };
    const reglas = plan({ quiet: [23, 8] });
    const dormido = runner.decidir(precios && reglas, precios, {}, new Date(2026, 8, 21, 3, 0, 0));
    expect(dormido.avisos).toHaveLength(0);

    // Lo importante: no quedo anotado como avisado mientras nadie miraba.
    const despierto = runner.decidir(reglas, precios, dormido.estado, new Date(2026, 8, 21, 9, 0, 0));
    expect(despierto.avisos).toHaveLength(1);
  });

  it("un activo sin cotizacion no rompe al resto", () => {
    const { avisos } = runner.decidir(
      plan({
        assets: [
          { sym: "BTC", src: "binance", ss: "BTCUSDT", cur: "USD", qty: 1, pct: 5 },
          { sym: "QQQ", src: "yahoo", ss: "QQQ", cur: "USD", qty: 10, pct: 5 },
        ],
      }),
      { "yahoo|QQQ": { price: 500, changePct: -7 } },
      {},
      MEDIODIA,
    );
    expect(avisos).toHaveLength(1);
    expect(avisos[0].title).toBe("QQQ -7,0%");
  });
});

describe("aviso de cartera", () => {
  const dosActivos = plan({
    portfolioPct: 3,
    cashUsd: 1000,
    assets: [
      { sym: "BTC", src: "binance", ss: "BTCUSDT", cur: "USD", qty: 1, pct: 0 },
      { sym: "QQQ", src: "yahoo", ss: "QQQ", cur: "USD", qty: 10, pct: 0 },
    ],
  });

  it("mide el movimiento del total, no el de un activo", () => {
    // BTC 9.000 (-10%) y QQQ 5.000 (+0%), mas 1.000 de efectivo.
    // Ayer: 10.000 + 5.000 + 1.000 = 16.000. Hoy: 15.000. -6,25%.
    const { avisos } = runner.decidir(
      dosActivos,
      {
        "binance|BTCUSDT": { price: 9000, changePct: -10 },
        "yahoo|QQQ": { price: 500, changePct: 0 },
      },
      {},
      MEDIODIA,
    );
    expect(avisos).toHaveLength(1);
    expect(avisos[0].title).toBe("Tu cartera -6,3%");
    expect(avisos[0].body).toContain("US$ 15.000");
  });

  it("el efectivo no se mueve y amortigua el porcentaje", () => {
    const sinEfectivo = runner.decidir(
      plan({
        portfolioPct: 3,
        cashUsd: 0,
        assets: [{ sym: "BTC", src: "binance", ss: "BTCUSDT", cur: "USD", qty: 1, pct: 0 }],
      }),
      { "binance|BTCUSDT": { price: 9000, changePct: -10 } },
      {},
      MEDIODIA,
    );
    expect(sinEfectivo.avisos[0].title).toBe("Tu cartera -10,0%");
  });

  it("los pesos se pasan a dolares al cambio que dejo la app", () => {
    const { avisos } = runner.decidir(
      plan({
        portfolioPct: 1,
        cashUsd: 0,
        arsPerUsd: 1000,
        assets: [{ sym: "GGAL", src: "byma", ss: "GGAL", cur: "ARS", qty: 100, pct: 0 }],
      }),
      { "byma|GGAL": { price: 5000, changePct: 10 } },
      {},
      MEDIODIA,
    );
    // 100 x 5.000 ARS = 500.000 ARS = US$ 500.
    expect(avisos[0].body).toContain("US$ 500");
  });

  it("sin cotizacion del dolar los pesos no se cuentan como dolares", () => {
    const { avisos } = runner.decidir(
      plan({
        portfolioPct: 1,
        cashUsd: 0,
        arsPerUsd: 0,
        assets: [{ sym: "GGAL", src: "byma", ss: "GGAL", cur: "ARS", qty: 100, pct: 0 }],
      }),
      { "byma|GGAL": { price: 5000, changePct: 10 } },
      {},
      MEDIODIA,
    );
    // Preferimos no avisar antes que avisar "US$ 500.000".
    expect(avisos).toHaveLength(0);
  });

  it("no repite el aviso de cartera en la misma corrida siguiente", () => {
    const precios = {
      "binance|BTCUSDT": { price: 9000, changePct: -10 },
      "yahoo|QQQ": { price: 500, changePct: 0 },
    };
    const primera = runner.decidir(dosActivos, precios, {}, MEDIODIA);
    const segunda = runner.decidir(dosActivos, precios, primera.estado, MEDIODIA);
    expect(segunda.avisos).toHaveLength(0);
  });
});

describe("resumen diario", () => {
  it("sale a la hora elegida", () => {
    const { avisos } = runner.decidir(
      plan({ digestHour: 18 }),
      { "binance|BTCUSDT": { price: 95000, changePct: 1 } },
      {},
      new Date(2026, 8, 21, 18, 5, 0),
    );
    expect(avisos).toHaveLength(1);
    expect(avisos[0].title).toContain("Waltra · US$ 95.000");
  });

  it("no sale antes de esa hora", () => {
    const { avisos } = runner.decidir(
      plan({ digestHour: 18 }),
      { "binance|BTCUSDT": { price: 95000, changePct: 1 } },
      {},
      new Date(2026, 8, 21, 17, 0, 0),
    );
    expect(avisos).toHaveLength(0);
  });

  it("sale una sola vez por dia", () => {
    const precios = { "binance|BTCUSDT": { price: 95000, changePct: 1 } };
    const reglas = plan({ digestHour: 18 });
    const tarde = new Date(2026, 8, 21, 18, 5, 0);
    const primera = runner.decidir(reglas, precios, {}, tarde);
    const segunda = runner.decidir(reglas, precios, primera.estado, new Date(2026, 8, 21, 19, 0, 0));
    expect(primera.avisos).toHaveLength(1);
    expect(segunda.avisos).toHaveLength(0);
  });

  it("y vuelve a salir al dia siguiente", () => {
    const precios = { "binance|BTCUSDT": { price: 95000, changePct: 1 } };
    const reglas = plan({ digestHour: 18 });
    const primera = runner.decidir(reglas, precios, {}, new Date(2026, 8, 21, 18, 5, 0));
    const otroDia = runner.decidir(reglas, precios, primera.estado, new Date(2026, 8, 22, 18, 5, 0));
    expect(otroDia.avisos).toHaveLength(1);
  });
});

describe("la corrida completa", () => {
  function entorno(planGuardado: unknown, respuestas: Record<string, unknown>) {
    const almacen: Record<string, string> = {};
    if (planGuardado) almacen["waltra.alertas.plan"] = JSON.stringify(planGuardado);
    const programadas: unknown[][] = [];
    const pedidos: string[] = [];
    return {
      almacen,
      programadas,
      pedidos,
      globals: {
        CapacitorKV: {
          get: (key: string) => {
            if (!(key in almacen)) throw new Error("no existe");
            return { value: almacen[key] };
          },
          set: (key: string, value: string) => {
            almacen[key] = value;
          },
          remove: (key: string) => {
            delete almacen[key];
          },
        },
        CapacitorNotifications: {
          schedule: (items: unknown[]) => programadas.push(items),
        },
        CapacitorDevice: {
          getNetworkStatus: () => ({ connected: true, connectionType: "wifi" }),
        },
        fetch: vi.fn(async (url: string) => {
          pedidos.push(url);
          const clave = Object.keys(respuestas).find((k) => url.includes(k));
          if (!clave) return { ok: false, status: 404, json: async () => ({}) };
          return { ok: true, status: 200, json: async () => respuestas[clave] };
        }),
      },
    };
  }

  async function correr(env: ReturnType<typeof entorno>) {
    const { listeners } = cargar(env.globals);
    await new Promise<void>((done, fail) => listeners.checkPrices(done, fail));
  }

  it("consulta Binance y notifica lo que paso el umbral", async () => {
    const env = entorno(plan(), {
      "api.binance.com": [{ symbol: "BTCUSDT", lastPrice: "95000", priceChangePercent: "-6.2" }],
    });
    await correr(env);

    expect(env.pedidos[0]).toContain("BTCUSDT");
    expect(env.programadas).toHaveLength(1);
    const [aviso] = env.programadas[0] as { title: string; scheduleAt: Date }[];
    expect(aviso.title).toBe("BTC -6,2%");
    // El Date sale del contexto del vm, asi que `instanceof` de afuera no
    // aplica: lo que importa es que sea una fecha y que sea futura.
    expect(typeof aviso.scheduleAt.getTime).toBe("function");
    expect(aviso.scheduleAt.getTime()).toBeGreaterThan(Date.now());
    // El estado quedo guardado para que la proxima corrida no repita.
    expect(env.almacen["waltra.alertas.estado"]).toContain("BTC");
  });

  it("lee el precio de Yahoo de donde lo lee la app", async () => {
    const env = entorno(
      plan({ assets: [{ sym: "QQQ", src: "yahoo", ss: "QQQ", cur: "USD", qty: 10, pct: 5 }] }),
      {
        "finance.yahoo.com": {
          chart: {
            result: [{ meta: { regularMarketPrice: 465, chartPreviousClose: 500 } }],
          },
        },
      },
    );
    await correr(env);
    const [aviso] = env.programadas[0] as { title: string }[];
    expect(aviso.title).toBe("QQQ -7,0%");
  });

  it("lee el precio de data912 de donde lo lee la app", async () => {
    const env = entorno(
      plan({
        arsPerUsd: 1000,
        assets: [{ sym: "GGAL", src: "byma", ss: "GGAL", cur: "ARS", qty: 100, pct: 5 }],
      }),
      { "data912.com": [{ symbol: "GGAL", c: 5000, pct_change: 8.5 }] },
    );
    await correr(env);
    const [aviso] = env.programadas[0] as { title: string; body: string }[];
    expect(aviso.title).toBe("GGAL +8,5%");
    expect(aviso.body).toContain("$ 5.000,00");
  });

  it("sin plan guardado no consulta nada", async () => {
    const env = entorno(null, {});
    await correr(env);
    expect(env.pedidos).toHaveLength(0);
    expect(env.programadas).toHaveLength(0);
  });

  it("un proveedor caido no deja la tarea colgada", async () => {
    const env = entorno(plan(), {});
    await correr(env);
    expect(env.programadas).toHaveLength(0);
  });

  it("sin red no sale a buscar precios", async () => {
    const env = entorno(plan(), {
      "api.binance.com": [{ symbol: "BTCUSDT", lastPrice: "95000", priceChangePercent: "-6.2" }],
    });
    env.globals.CapacitorDevice.getNetworkStatus = () => ({
      connected: false,
      connectionType: "none",
    });
    await correr(env);
    expect(env.pedidos).toHaveLength(0);
  });
});
