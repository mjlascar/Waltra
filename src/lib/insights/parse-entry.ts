import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { resolveModel } from "@/lib/insights/models";
import { InsightError } from "@/lib/insights/generate";

/**
 * Respaldo del parser local para frases raras.
 *
 * El parser de src/lib/parse resuelve el 90% sin salir del telefono y sin
 * gastar un centavo; esto solo entra cuando el usuario lo pide expresamente
 * sobre una frase que no se entendio.
 */
export const ParseRequestSchema = z.object({
  text: z.string().min(1).max(400),
  accounts: z.array(z.object({ id: z.string(), name: z.string() })).max(20),
  symbols: z.array(z.string()).max(200).default([]),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type ParseRequest = z.output<typeof ParseRequestSchema>;

const EntrySchema = z.object({
  type: z.enum(["deposit", "withdraw", "buy", "sell", "dividend", "interest", "fee", "transfer"]),
  date: z.string().describe("YYYY-MM-DD"),
  accountId: z.string().nullable().describe("id de la cuenta de origen, o null si no se menciona"),
  counterAccountId: z.string().nullable().describe("solo para transferencias entre cuentas propias"),
  symbol: z.string().nullable().describe("ticker en mayusculas, o null"),
  quantity: z.number().nullable().describe("unidades del activo"),
  price: z.number().nullable().describe("precio por unidad"),
  amount: z.number().nullable().describe("monto total de plata movida, siempre positivo"),
  currency: z.enum(["USD", "ARS"]),
  fee: z.number().nullable(),
  note: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().describe("Una linea explicando como lo interpretaste."),
});

export type ParsedEntry = z.infer<typeof EntrySchema>;

const SYSTEM = `Convertis frases sueltas en castellano rioplatense en movimientos de una cartera de inversion.

Reglas:
- "pase/mande/cargue plata a <cuenta>" es deposit. "retire/saque" es withdraw.
- "pase X de <cuenta A> a <cuenta B>" entre dos cuentas propias es transfer.
- En "compre 50 de QQQ", 50 es PLATA. En "compre 2 QQQ", 2 son UNIDADES. La diferencia esta en el "de".
- Numeros en formato argentino: "1.500" es mil quinientos, "0,5" es un medio.
- Si no se menciona la moneda, es USD.
- Fechas relativas contra la fecha de hoy que te doy. Sin fecha, es hoy.
- Si algo no esta en la frase, devolve null. No inventes montos ni precios.`;

export async function parseEntry(
  client: Anthropic,
  body: ParseRequest,
): Promise<ParsedEntry> {
  const { text, accounts, symbols, today } = body;
  try {
    const result = await client.messages.parse({
      model: resolveModel(undefined),
      max_tokens: 2000,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Hoy: ${today}
Cuentas disponibles: ${accounts.map((a) => `${a.id} = "${a.name}"`).join(", ")}
Tickers que el usuario ya tiene: ${symbols.join(", ") || "ninguno"}

Frase: "${text}"`,
        },
      ],
      output_config: { format: zodOutputFormat(EntrySchema) },
    });

    if (!result.parsed_output) {
      throw new InsightError("No se pudo interpretar.", "parse_failed", 502);
    }
    return result.parsed_output;
  } catch (err) {
    if (err instanceof InsightError) throw err;
    throw new InsightError(err instanceof Error ? err.message : String(err), "api_error", 502);
  }
}
