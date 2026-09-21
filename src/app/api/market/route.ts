import { NextResponse } from "next/server";
import { checkAccess } from "@/lib/api-auth";
import { SyncRequestSchema, syncMarket } from "@/lib/market/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** La logica esta en @/lib/market/sync: el APK la corre sin pasar por aca. */
export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;

  const parsed = SyncRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }
  return NextResponse.json(await syncMarket(parsed.data));
}
