import { NextResponse, type NextRequest } from "next/server";

import { validateMintAddress } from "@/lib/solana/address";
import { getPriceHistory } from "@/lib/providers/geckoterminal";
import { getCached, setCached } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Short-range price history for the market-context chart.
 *
 * Separate from the analysis endpoint on purpose. The verdict must not wait on
 * a chart, and a chart that cannot be drawn must not degrade the verdict — so
 * the report renders first and this is fetched beside it.
 *
 * Both parameters are untrusted. The mint goes through the same validator the
 * analysis endpoint uses, the pool is checked to be a well-formed address
 * before it is ever put in a URL, and the provider then requires the pool to
 * name this mint as its base token before returning anything.
 *
 * Nothing here reaches the risk engine. This endpoint is context only.
 */
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

  const key = `history:${mint.address}:${pool.address}`;
  const cached = getCached<unknown>(key);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "private, max-age=60", "X-Cache": "hit" },
    });
  }

  const history = await getPriceHistory(mint.address, pool.address);

  // Cached briefly either way: a token with no indexed history should not send
  // a request upstream on every render.
  setCached(key, history, 60_000);

  return NextResponse.json(history, {
    headers: { "Cache-Control": "private, max-age=60", "X-Cache": "miss" },
  });
}
