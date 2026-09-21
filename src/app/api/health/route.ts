import { NextResponse } from "next/server";
import { checkAccess } from "@/lib/api-auth";
import { MOCK_ENABLED, probeProviders } from "@/lib/market/diagnostics";
import { resolveModel } from "@/lib/insights/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;

  const base = {
    mock: MOCK_ENABLED,
    aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    model: resolveModel(undefined),
  };

  // ?light=1 responde solo la configuracion, sin golpear a los proveedores.
  // La usa la pantalla de Insights al abrir, que solo necesita saber si hay
  // clave cargada: probar las cuatro fuentes ahi seria gasto al pedo.
  if (new URL(request.url).searchParams.get("light") === "1") {
    return NextResponse.json({ ...base, providers: [], at: new Date().toISOString() });
  }

  const { providers, totalMs } = await probeProviders();
  return NextResponse.json({ ...base, providers, totalMs, at: new Date().toISOString() });
}
