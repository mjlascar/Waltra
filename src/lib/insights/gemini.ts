import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { ReportSchema } from "@/lib/insights/digest";
import { ModelError, type Engine } from "@/lib/insights/engine";

/**
 * Gemini, por la API de Google AI.
 *
 * Dos diferencias con Anthropic que explican la forma de abajo:
 *
 * 1. La busqueda de Google y el formato JSON estricto no se pueden pedir en
 *    el mismo turno. Por eso el informe se arma en dos pasos, que es lo que
 *    el contrato de `Engine` ya impone.
 * 2. Gemini devuelve las fuentes en metadatos aparte (`groundingChunks`) y no
 *    dentro del texto, asi que salen limpias sin tener que buscarlas a mano.
 */
export function geminiEngine(apiKey: string): Engine {
  const ai = new GoogleGenAI({ apiKey });

  return {
    async investigar({ model, system, user }) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: user,
          config: {
            systemInstruction: system,
            tools: [{ googleSearch: {} }],
          },
        });

        const texto = res.text ?? "";
        const fuentes: { title: string; url: string }[] = [];
        const vistas = new Set<string>();
        const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
        for (const chunk of chunks) {
          const url = chunk.web?.uri;
          if (!url || vistas.has(url)) continue;
          vistas.add(url);
          fuentes.push({ title: chunk.web?.title ?? url, url });
        }
        return { texto, fuentes };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // El SDK no expone una clase de error con status, asi que se deduce
        // del mensaje lo minimo para distinguir "clave mala" de "fallo".
        const status = /API key|API_KEY|permission|401|403/i.test(message) ? 401 : 502;
        throw new ModelError(message, status === 401 ? "bad_key" : "api_error", status);
      }
    },

    async estructurar({ model, system, user }) {
      const res = await ai.models.generateContent({
        model,
        contents: user,
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          // El esquema se manda como JSON Schema, que es lo que Gemini lee.
          responseJsonSchema: z.toJSONSchema(ReportSchema, { io: "output" }),
        },
      });

      const texto = res.text;
      if (!texto) return null;
      try {
        return ReportSchema.parse(JSON.parse(texto));
      } catch {
        // Si no vino el JSON que pedimos, el informe igual se salva en prosa.
        return null;
      }
    },
  };
}
