import { NextResponse } from "next/server";
import { z } from "zod";
import { checkAccess } from "@/lib/api-auth";
import { MOCK_ENABLED, fetchFx, fetchHistory, fetchQuotes } from "@/lib/market";
import type { MarketRef } from "@/lib/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RefSchema = z.object({
  assetId: z.string().min(1),
  symbol: z.string().min(1),
  source: z.enum(["binance", "yahoo", "byma", "manual"]),
  sourceSymbol: z.string().min(1),
  currency: z.enum(["USD", "ARS"]),
});

const BodySchema = z.object({
  refs: z.array(RefSchema).max(200).default([]),
  /** Activos para los que ademas queremos la serie historica. */
  history: z.array(z.string()).max(200).default([]),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  includeFx: z.boolean().default(true),
});

export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Pedido invalido." }, { status: 400 });
  }
  const { refs, history, from, includeFx } = parsed.data;
  const since = from ?? new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);

  const wanted = new Set(history);
  const historyRefs: MarketRef[] = refs.filter((r) => wanted.has(r.assetId));

  const [quotes, historyResults, fx] = await Promise.all([
    fetchQuotes(refs),
    // Los proveedores se consultan en paralelo pero de a tandas chicas para
    // no gatillar los limites de rate de Yahoo.
    runBatched(historyRefs, 6, (ref) => fetchHistory({ ...ref, from: since })),
    includeFx ? fetchFx(since) : Promise.resolve({ rates: [], latest: null }),
  ]);

  return NextResponse.json({
    quotes,
    history: historyResults,
    fx: fx.rates,
    fxLatest: fx.latest,
    mock: MOCK_ENABLED,
    at: new Date().toISOString(),
  });
}

async function runBatched<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = await Promise.allSettled(items.slice(i, i + size).map(fn));
    for (const r of batch) if (r.status === "fulfilled") out.push(r.value);
  }
  return out;
}
