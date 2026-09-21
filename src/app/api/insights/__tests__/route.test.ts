import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La ruta de insights es el unico camino que no se puede ejercitar contra la
 * API real desde CI, y es el que mas partes moviles tiene: dos llamadas
 * encadenadas, una busqueda web, un formato estricto y una degradacion. Se
 * prueba con el SDK simulado.
 */

const stream = vi.fn();
const parse = vi.fn();

class FakeAPIError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    messages = {
      stream: (...args: unknown[]) => stream(...args),
      parse: (...args: unknown[]) => parse(...args),
    };
    static APIError = FakeAPIError;
  }
  return { default: Anthropic, APIError: FakeAPIError };
});

vi.mock("@anthropic-ai/sdk/helpers/zod", () => ({
  zodOutputFormat: () => ({ type: "json_schema" }),
}));

const CARTERA = {
  holdings: [
    {
      symbol: "QQQ",
      kind: "etf",
      weightPct: 100,
      valueUsd: 1000,
      costUsd: 900,
      returnPct: 11.1,
      heldDays: 200,
    },
  ],
  totals: {
    valueUsd: 1000,
    contributedUsd: 900,
    cashUsd: 0,
    pnlUsd: 100,
    twrPct: 11.1,
    xirrPct: 20,
    volatilityPct: 18,
    maxDrawdownPct: -8,
    ageDays: 200,
  },
  behaviour: {
    transactions: 4,
    depositsLast90d: 1,
    tradesLast90d: 1,
    avgDepositUsd: 450,
    accounts: ["Cocos Capital"],
  },
  profile: { riskProfile: "moderado", horizonYears: 5, goals: "" },
};

const INFORME = {
  marketBrief: "El Nasdaq subió. https://reuters.com/nota",
  signals: [
    {
      symbol: "QQQ",
      action: "mantener",
      confidence: "alta",
      headline: "Sin novedades que cambien la tesis",
      rationale: "Nada relevante en dos semanas.",
      horizon: "6 meses",
    },
  ],
  profileRead: { summary: "Aportás parejo.", observations: [], risks: [], suggestions: [] },
  sources: [{ title: "reuters.com", url: "https://reuters.com/nota" }],
};

function pedido(body: unknown) {
  return new Request("http://localhost/api/insights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function textoDe(texto: string) {
  return { content: [{ type: "text", text: texto }] };
}

let POST: (request: Request) => Promise<Response>;

beforeEach(async () => {
  vi.resetModules();
  stream.mockReset();
  parse.mockReset();
  process.env.ANTHROPIC_API_KEY = "clave-de-prueba";
  delete process.env.WALTRA_MODEL;
  ({ POST } = await import("@/app/api/insights/route"));
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.WALTRA_ACCESS_KEY;
});

describe("POST /api/insights", () => {
  it("encadena la investigación y el estructurado", async () => {
    stream.mockReturnValue({ finalMessage: async () => textoDe("Informe largo.") });
    parse.mockResolvedValue({ parsed_output: INFORME });

    const res = await POST(pedido(CARTERA));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.signals[0].symbol).toBe("QQQ");
    expect(data.degraded).toBe(false);
    expect(data.model).toBe("claude-opus-5");
    // El resumen de cartera vuelve para poder auditar el informe despues.
    expect(data.portfolioDigest).toContain("QQQ");

    // La investigación va con búsqueda web y el informe entra en el segundo paso.
    const research = stream.mock.calls[0][0];
    expect(research.tools[0].name).toBe("web_search");
    expect(parse.mock.calls[0][0].messages[0].content).toContain("Informe largo.");
  });

  it("le pide a Opus la búsqueda nueva y pensamiento adaptativo", async () => {
    stream.mockReturnValue({ finalMessage: async () => textoDe("x") });
    parse.mockResolvedValue({ parsed_output: INFORME });
    await POST(pedido(CARTERA));
    const research = stream.mock.calls[0][0];
    expect(research.tools[0].type).toBe("web_search_20260209");
    expect(research.thinking).toEqual({ type: "adaptive" });
  });

  it("a Haiku le pide la búsqueda básica y sin adaptativo", async () => {
    stream.mockReturnValue({ finalMessage: async () => textoDe("x") });
    parse.mockResolvedValue({ parsed_output: INFORME });
    await POST(pedido({ ...CARTERA, model: "claude-haiku-4-5" }));
    const research = stream.mock.calls[0][0];
    expect(research.model).toBe("claude-haiku-4-5");
    expect(research.tools[0].type).toBe("web_search_20250305");
    expect(research.thinking).toBeUndefined();
  });

  it("ignora un modelo que no está en la lista blanca", async () => {
    stream.mockReturnValue({ finalMessage: async () => textoDe("x") });
    parse.mockResolvedValue({ parsed_output: INFORME });
    await POST(pedido({ ...CARTERA, model: "modelo-carisimo-inventado" }));
    expect(stream.mock.calls[0][0].model).toBe("claude-opus-5");
  });

  it("si el estructurado falla, devuelve el informe igual", async () => {
    stream.mockReturnValue({
      finalMessage: async () => textoDe("El Nasdaq subió. Fuente: https://reuters.com/nota"),
    });
    parse.mockRejectedValue(new Error("no se pudo parsear"));

    const res = await POST(pedido(CARTERA));
    expect(res.status).toBe(200);
    const data = await res.json();
    // La busqueda ya se pago: tirar el texto seria el peor resultado.
    expect(data.degraded).toBe(true);
    expect(data.marketBrief).toContain("El Nasdaq subió");
    expect(data.sources[0].url).toBe("https://reuters.com/nota");
  });

  it("un informe vacío es un error, no un informe en blanco", async () => {
    stream.mockReturnValue({ finalMessage: async () => textoDe("   ") });
    const res = await POST(pedido(CARTERA));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("empty_research");
    expect(parse).not.toHaveBeenCalled();
  });

  it("propaga el código de estado de la API", async () => {
    stream.mockImplementation(() => {
      throw new FakeAPIError(429, "rate limit");
    });
    const res = await POST(pedido(CARTERA));
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("api_error");
  });

  it("sin clave no intenta llamar a nadie", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.resetModules();
    const { POST: sinClave } = await import("@/app/api/insights/route");
    const res = await sinClave(pedido(CARTERA));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("no_api_key");
    expect(stream).not.toHaveBeenCalled();
  });

  it("una cartera vacía no gasta créditos", async () => {
    const res = await POST(pedido({ ...CARTERA, holdings: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("empty_portfolio");
    expect(stream).not.toHaveBeenCalled();
  });

  it("un pedido con otra forma se rechaza", async () => {
    const res = await POST(pedido({ cualquier: "cosa" }));
    expect(res.status).toBe(400);
    expect(stream).not.toHaveBeenCalled();
  });

  it("con clave de acceso configurada, exige la cabecera", async () => {
    process.env.WALTRA_ACCESS_KEY = "secreto";
    vi.resetModules();
    const { POST: protegido } = await import("@/app/api/insights/route");

    const sinCabecera = await protegido(pedido(CARTERA));
    expect(sinCabecera.status).toBe(401);
    expect(stream).not.toHaveBeenCalled();

    stream.mockReturnValue({ finalMessage: async () => textoDe("x") });
    parse.mockResolvedValue({ parsed_output: INFORME });
    const conCabecera = await protegido(
      new Request("http://localhost/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-waltra-key": "secreto" },
        body: JSON.stringify(CARTERA),
      }),
    );
    expect(conCabecera.status).toBe(200);
  });
});
