import { NextResponse, type NextRequest } from "next/server";

import { validateMintAddress } from "@/lib/solana/address";
import { getPriceHistory } from "@/lib/providers/geckoterminal";
import { historyCacheKey } from "@/lib/market/policy";
import { getCached, setCached } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Optional history endpoint; analysis performs its own integrity check before scoring. */
export async function GET(request: NextRequest) {
  const mintRaw = request.nextUrl.searchParams.get("mint") ?? "";
  const poolRaw = request.nextUrl.searchParams.get("pool") ?? "";

  const mint = validateMintAddress(mintRaw);
  if (!mint.valid) {
    return NextResponse.json({ error: mint.reason }, { status: 400 });
  }

  // A pool address is an ordinary account address, so the same validator is
  // the right format check for it.
  const pool = validateMintAddress(poolRaw);
  if (!pool.valid) {
    return NextResponse.json({ error: "Invalid pool address." }, { status: 400 });
  }

  const key = historyCacheKey(mint.address, pool.address);
  const cached = getCached<unknown>(key);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "private, no-store", "X-Cache": "hit" },
    });
  }

  const history = await getPriceHistory(mint.address, pool.address);

  // Cached briefly either way: a token with no indexed history should not send
  // a request upstream on every render.
  setCached(key, history, 60_000);

  return NextResponse.json(history, {
    headers: { "Cache-Control": "private, no-store", "X-Cache": "miss" },
  });
}
