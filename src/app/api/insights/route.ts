import { NextResponse } from "next/server";
import { checkAccess } from "@/lib/api-auth";
import { InsightRequestSchema } from "@/lib/insights/digest";
import { generate, InsightError } from "@/lib/insights/generate";
import { resolveProvider } from "@/lib/insights/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * En modo servidor la clave la pone el deploy, una por proveedor. Cual se usa
 * lo decide el pedido, porque el usuario elige el proveedor en Ajustes.
 */
function keyFor(provider: string): string | undefined {
  return provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY;
}

export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;

  const parsed = InsightRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const provider = resolveProvider(parsed.data.provider);
  const apiKey = keyFor(provider);
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          provider === "gemini"
            ? "Falta GEMINI_API_KEY. Cargala en el entorno del servidor para habilitar los insights."
            : "Falta ANTHROPIC_API_KEY. Cargala en el entorno del servidor para habilitar los insights.",
        code: "no_api_key",
      },
      { status: 503 },
    );
  }

  try {
    return NextResponse.json(await generate(provider, apiKey, false, parsed.data));
  } catch (err) {
    if (err instanceof InsightError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }
}
