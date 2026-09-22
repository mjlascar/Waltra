import { NextResponse } from "next/server";
import { z } from "zod";
import { checkAccess } from "@/lib/api-auth";
import { searchSymbols } from "@/lib/market/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ q: z.string().min(1).max(60) });

/** La logica esta en @/lib/market/search: el APK la corre sin pasar por aca. */
export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;

  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });

  try {
    return NextResponse.json({ hits: await searchSymbols(parsed.data.q) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
