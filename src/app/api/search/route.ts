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

  // Un proveedor caido no es un error del pedido: se devuelve sin resultados
  // y con el motivo, como el resto de los proveedores. Con un 502 el
  // navegador lo anota como error y quien llama no puede seguir con lo suyo
  // (por ejemplo, ofrecer cargar una ON que Yahoo no conoce).
  try {
    return NextResponse.json({ hits: await searchSymbols(parsed.data.q) });
  } catch (err) {
    return NextResponse.json({ hits: [], error: err instanceof Error ? err.message : String(err) });
  }
}
