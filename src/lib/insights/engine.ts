import type { Report } from "@/lib/insights/digest";
import type { Provider } from "@/lib/insights/providers";

/**
 * El contrato que cumple cada proveedor.
 *
 * El informe se arma en dos pasos y no en uno a proposito: las citas de la
 * busqueda web y un formato JSON estricto no conviven bien en el mismo turno.
 * En Anthropic sale mal; en Gemini directamente no se pueden pedir juntos.
 * Asi que primero se investiga en prosa y despues se estructura, sin busqueda,
 * en una llamada aparte.
 *
 * `estructurar` puede fallar sin que se pierda el informe: la busqueda ya se
 * pago y el texto en prosa sirve igual.
 */
export interface Engine {
  /** Paso 1: investigar con busqueda web y devolver el informe en prosa. */
  investigar(pedido: {
    model: string;
    system: string;
    user: string;
  }): Promise<{ texto: string; fuentes: { title: string; url: string }[] }>;

  /** Paso 2: convertir ese texto en datos. */
  estructurar(pedido: {
    model: string;
    system: string;
    user: string;
  }): Promise<Report | null>;
}

export class ModelError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ModelError";
  }
}

/**
 * El motor del proveedor elegido.
 *
 * Se carga con `import()` dinamico para que el bundle no arrastre los dos
 * SDK cuando solo se va a usar uno.
 */
export async function engineFor(provider: Provider, apiKey: string, onDevice: boolean): Promise<Engine> {
  if (provider === "gemini") {
    const { geminiEngine } = await import("@/lib/insights/gemini");
    return geminiEngine(apiKey);
  }
  const { anthropicEngine } = await import("@/lib/insights/anthropic");
  return anthropicEngine(apiKey, onDevice);
}
