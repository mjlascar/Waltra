import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El camino de Gemini no se puede ejercitar contra la API real desde CI, y
 * tiene dos diferencias con Anthropic que son justamente las que conviene
 * fijar: la busqueda va como herramienta aparte y las fuentes vienen en
 * metadatos en vez de adentro del texto.
 */
const generateContent = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: (...args: unknown[]) => generateContent(...args) };
  },
}));

beforeEach(() => generateContent.mockReset());

const INFORME = {
  marketBrief: "El mercado viene lateral.",
  signals: [
    {
      symbol: "QQQ",
      action: "mantener",
      confidence: "media",
      headline: "Sin novedades",
      rationale: "Nada cambió esta semana.",
      horizon: "1 mes",
    },
  ],
  profileRead: { summary: "Perfil moderado.", observations: [], risks: [], suggestions: [] },
  sources: [],
};

describe("motor de Gemini", () => {
  it("pide la búsqueda de Google en el paso de investigación", async () => {
    generateContent.mockResolvedValueOnce({ text: "informe", candidates: [] });
    const { geminiEngine } = await import("@/lib/insights/gemini");
    await geminiEngine("k").investigar({ model: "gemini-pro-latest", system: "s", user: "u" });

    const [args] = generateContent.mock.calls[0] as [Record<string, unknown>];
    const config = args.config as Record<string, unknown>;
    expect(config.tools).toEqual([{ googleSearch: {} }]);
    expect(config.systemInstruction).toBe("s");
    // Sin formato estricto en este paso: Gemini no acepta las dos cosas juntas.
    expect(config.responseJsonSchema).toBeUndefined();
  });

  it("saca las fuentes de los metadatos, no del texto", async () => {
    generateContent.mockResolvedValueOnce({
      text: "informe sin URLs a la vista",
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: "https://a.com/x", title: "Nota A" } },
              { web: { uri: "https://b.com/y", title: "Nota B" } },
              // Repetida: no tiene que aparecer dos veces.
              { web: { uri: "https://a.com/x", title: "Nota A otra vez" } },
              // Sin URL: no sirve como fuente.
              { web: { title: "Sin link" } },
            ],
          },
        },
      ],
    });
    const { geminiEngine } = await import("@/lib/insights/gemini");
    const res = await geminiEngine("k").investigar({
      model: "gemini-pro-latest",
      system: "s",
      user: "u",
    });
    expect(res.fuentes).toEqual([
      { title: "Nota A", url: "https://a.com/x" },
      { title: "Nota B", url: "https://b.com/y" },
    ]);
  });

  it("el paso de estructurado pide JSON y no lleva búsqueda", async () => {
    generateContent.mockResolvedValueOnce({ text: JSON.stringify(INFORME) });
    const { geminiEngine } = await import("@/lib/insights/gemini");
    const report = await geminiEngine("k").estructurar({
      model: "gemini-pro-latest",
      system: "s",
      user: "u",
    });

    const [args] = generateContent.mock.calls[0] as [Record<string, unknown>];
    const config = args.config as Record<string, unknown>;
    expect(config.responseMimeType).toBe("application/json");
    expect(config.responseJsonSchema).toBeTruthy();
    expect(config.tools).toBeUndefined();
    expect(report?.signals[0].symbol).toBe("QQQ");
  });

  it("un JSON que no cumple el esquema no rompe: el informe se salva en prosa", async () => {
    generateContent.mockResolvedValueOnce({ text: '{"cualquier":"cosa"}' });
    const { geminiEngine } = await import("@/lib/insights/gemini");
    expect(
      await geminiEngine("k").estructurar({ model: "gemini-pro-latest", system: "s", user: "u" }),
    ).toBeNull();
  });

  it("una respuesta vacía tampoco rompe", async () => {
    generateContent.mockResolvedValueOnce({ text: undefined });
    const { geminiEngine } = await import("@/lib/insights/gemini");
    expect(
      await geminiEngine("k").estructurar({ model: "gemini-pro-latest", system: "s", user: "u" }),
    ).toBeNull();
  });

  it("una clave mala se distingue de una falla cualquiera", async () => {
    const { geminiEngine } = await import("@/lib/insights/gemini");
    const engine = geminiEngine("k");

    generateContent.mockRejectedValueOnce(new Error("API key not valid"));
    await expect(
      engine.investigar({ model: "gemini-pro-latest", system: "s", user: "u" }),
    ).rejects.toMatchObject({ code: "bad_key", status: 401 });

    generateContent.mockRejectedValueOnce(new Error("503 backend unavailable"));
    await expect(
      engine.investigar({ model: "gemini-pro-latest", system: "s", user: "u" }),
    ).rejects.toMatchObject({ code: "api_error", status: 502 });
  });
});
