import { NextResponse } from "next/server";
import { checkAccess } from "@/lib/api-auth";
import { InsightRequestSchema } from "@/lib/insights/digest";
import { anthropicFor, generateReport, InsightError } from "@/lib/insights/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Falta ANTHROPIC_API_KEY. Cargala en el entorno del servidor para habilitar los insights.",
        code: "no_api_key",
      },
      { status: 503 },
    );
  }

  const parsed = InsightRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  try {
    return NextResponse.json(await generateReport(anthropicFor(apiKey, false), parsed.data));
  } catch (err) {
    if (err instanceof InsightError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }
}
