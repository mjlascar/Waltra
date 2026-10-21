import { NextResponse } from "next/server";
import { checkAccess } from "@/lib/api-auth";
import { CapturasRequestSchema, LECTURA_DE_PRUEBA, leerCapturas } from "@/lib/insights/capturas";
import { ModelError } from "@/lib/insights/engine";
import { resolveProvider } from "@/lib/insights/providers";
import { MOCK_ENABLED } from "@/lib/market/mock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** En modo servidor, la clave del proveedor la pone el deploy. */
function keyFor(provider: string): string | undefined {
  return provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY;
}

export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;

  const parsed = CapturasRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });

  // Con WALTRA_MOCK=1 no se gasta: vuelve una lectura fija, marcada.
  if (MOCK_ENABLED) return NextResponse.json({ texto: LECTURA_DE_PRUEBA, mock: true });

  const provider = resolveProvider(parsed.data.provider);
  const apiKey = keyFor(provider);
  if (!apiKey) {
    return NextResponse.json(
      {
        error: provider === "gemini" ? "Falta GEMINI_API_KEY en el servidor." : "Falta ANTHROPIC_API_KEY en el servidor.",
        code: "no_api_key",
      },
      { status: 503 },
    );
  }

  try {
    return NextResponse.json(await leerCapturas(provider, apiKey, false, parsed.data));
  } catch (err) {
    if (err instanceof ModelError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }
}
