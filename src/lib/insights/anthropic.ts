import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ReportSchema, extractUrls } from "@/lib/insights/digest";
import { modelShape } from "@/lib/insights/providers";
import { ModelError, type Engine } from "@/lib/insights/engine";

/**
 * Claude, por la API de Anthropic.
 *
 * En el telefono hay que habilitar el uso desde el navegador y mandar la
 * cabecera de acceso directo: la clave es del usuario y viaja de su WebView a
 * api.anthropic.com sin escalas. En el servidor nada de eso corresponde.
 */
export function anthropicClient(apiKey: string, onDevice: boolean): Anthropic {
  if (!onDevice) return new Anthropic({ apiKey });
  return new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    defaultHeaders: { "anthropic-dangerous-direct-browser-access": "true" },
  });
}

export function anthropicEngine(apiKey: string, onDevice: boolean): Engine {
  const client = anthropicClient(apiKey, onDevice);

  return {
    async investigar({ model, system, user }) {
      const shape = modelShape(model);
      try {
        // Va en streaming porque puede encadenar varias busquedas y tardar.
        const research = await client.messages
          .stream({
            model,
            max_tokens: 16000,
            system,
            ...(shape.adaptiveThinking ? { thinking: { type: "adaptive" as const } } : {}),
            tools: [{ type: shape.webSearchType, name: "web_search", max_uses: 8 }],
            messages: [{ role: "user", content: user }],
          })
          .finalMessage();

        const texto = research.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("\n\n");

        // Claude cita con la URL adentro del texto; no hay metadatos aparte.
        return { texto, fuentes: extractUrls(texto) };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = err instanceof Anthropic.APIError ? (err.status ?? 502) : 502;
        throw new ModelError(message, "api_error", status);
      }
    },

    async estructurar({ model, system, user }) {
      const structured = await client.messages.parse({
        model,
        max_tokens: 8000,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { format: zodOutputFormat(ReportSchema) },
      });
      return structured.parsed_output ?? null;
    },
  };
}
