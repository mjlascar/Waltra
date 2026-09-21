import { NextResponse } from "next/server";
import { checkAccess } from "@/lib/api-auth";
import { anthropicFor, InsightError } from "@/lib/insights/generate";
import { ParseRequestSchema, parseEntry } from "@/lib/insights/parse-entry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Falta ANTHROPIC_API_KEY.", code: "no_api_key" }, { status: 503 });
  }
  const parsed = ParseRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });

  try {
    return NextResponse.json(await parseEntry(anthropicFor(apiKey, false), parsed.data));
  } catch (err) {
    if (err instanceof InsightError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }
}
