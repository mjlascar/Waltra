import { z } from "zod";
import { engineFor, ModelError } from "@/lib/insights/engine";
import { resolveModel, type Provider } from "@/lib/insights/providers";

/**
 * Leer movimientos de capturas de pantalla.
 *
 * Cocos no tiene API ni una exportacion de movimientos: lo unico que muestra
 * es la pestaña Actividad. El modelo no carga nada: transcribe cada
 * movimiento a una linea con el formato de "Pegar movimientos", y esas lineas
 * pasan por el mismo parser y la misma revision que lo que uno escribe a mano.
 * Asi la regla de los CEDEAR, la de los bonos y las de cada tipo de movimiento
 * siguen viviendo en un solo lugar, y lo que el modelo leyo mal se ve antes de
 * guardar.
 *
 * Es la unica parte de la app que manda algo mas que tickers y numeros a un
 * modelo: la captura viaja como esta. Por eso es siempre a pedido, con la
 * clave del usuario, y la pantalla lo avisa antes de mandar.
 */

export const CapturasRequestSchema = z.object({
  provider: z.enum(["anthropic", "gemini"]).optional(),
  model: z.string().max(80).optional(),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  images: z
    .array(
      z.object({
        mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
        // Base64. Una captura achicada pesa unos cientos de KB.
        data: z.string().min(100).max(6_000_000),
      }),
    )
    .min(1)
    .max(40),
});

export type CapturasRequest = z.input<typeof CapturasRequestSchema>;

export interface CapturasResult {
  texto: string;
  /** Respuesta de prueba de `WALTRA_MOCK=1`: la pantalla lo avisa. */
  mock?: boolean;
}

/**
 * Los ejemplos son frases que el parser de la app entiende tal cual: hay un
 * test que las pasa por `parseBulk`. Si se cambia una, que siga pasando.
 */
export const EJEMPLOS = [
  "15/10/2026 compré 9 SPY por 456345 pesos",
  "16/10/2026 vendí 20 QQQ por 520 usd",
  "17/10/2026 compré 100 dólares por 145000 pesos",
  "18/10/2026 ingresé 500 dólares",
  "19/10/2026 retiré 200 dólares",
  "20/10/2026 dividendo 4.5 usd de QQQ",
  "20/10/2026 interés 3.4 usd",
];

export const CAPTURAS_SYSTEM = `Leés capturas de pantalla de la app o la web de un broker argentino (Cocos Capital, por ejemplo) y pasás cada movimiento a una línea de texto.

Formato: una línea por movimiento y nada más. Sin viñetas, sin títulos, sin comentarios, sin bloque de código. Así:
${EJEMPLOS.join("\n")}

Reglas:
- La fecha va primero, DD/MM/AAAA. Si la captura no dice el año, usá el de la fecha de hoy que te paso, salvo que eso la deje en el futuro: entonces es el año anterior.
- "por" va con el total de plata que se movió en esa operación, comisiones incluidas: lo que salió o entró de la cuenta.
- Compras y ventas llevan la cantidad de unidades o nominales antes del ticker.
- El ticker, tal como lo muestra la captura (SPY, QQQ, AL30, VSCYO). No lo traduzcas ni le agregues sufijos.
- La moneda: "pesos" o "usd". Un monto con $ solo es en pesos; con US$ o USD, en dólares.
- Punto decimal y sin separador de miles. Nunca exactamente tres decimales: escribí 1.2340, no 1.234.
- Las capturas se superponen (al hacer scroll, o porque una larga va en pedazos): la misma fila que aparece en dos capturas va una sola vez. Dos movimientos iguales en filas distintas son dos.
- Si un movimiento no se lee bien o no sabés qué es, escribilo igual con # al principio y lo que entendiste.
- Ignorá saldos, totales, cotizaciones y todo lo que no sea un movimiento. Una orden cancelada o rechazada no es un movimiento.
- No inventes nada. Si no hay movimientos, no escribas nada.`;

export function capturasUser(today: string): string {
  return `Hoy es ${today}. Pasá a líneas los movimientos de estas capturas.`;
}

/**
 * El pedido para copiar en claude.ai o en la app de Gemini, cuando no hay
 * clave de API: el mismo texto, en un solo mensaje, para mandar con las
 * capturas adjuntas.
 */
export function pedidoExterno(today: string): string {
  return `${CAPTURAS_SYSTEM}\n\n${capturasUser(today)} (Te las adjunto.)`;
}

/** Lo que haya agregado el modelo alrededor de las lineas: bloques de codigo, viñetas. */
export function limpiarLineas(texto: string): string {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^```/.test(l))
    .map((l) => l.replace(/^[-*•]\s+/, ""))
    .join("\n");
}

export async function leerCapturas(
  provider: Provider,
  apiKey: string,
  onDevice: boolean,
  req: z.output<typeof CapturasRequestSchema>,
): Promise<CapturasResult> {
  const engine = await engineFor(provider, apiKey, onDevice);
  try {
    const texto = await engine.leer({
      model: resolveModel(provider, req.model),
      system: CAPTURAS_SYSTEM,
      user: capturasUser(req.today),
      images: req.images,
    });
    return { texto: limpiarLineas(texto) };
  } catch (err) {
    if (err instanceof ModelError) throw err;
    throw new ModelError(err instanceof Error ? err.message : String(err), "api_error", 502);
  }
}

/** Lo que contesta `WALTRA_MOCK=1`, para probar la pantalla sin gastar. */
export const LECTURA_DE_PRUEBA = [
  "13/10/2026 compré 9 SPY por 456345 pesos",
  "14/10/2026 compré 100 dólares por 145000 pesos",
  "# 15/10/2026 no se lee bien: compra de AL30",
].join("\n");
