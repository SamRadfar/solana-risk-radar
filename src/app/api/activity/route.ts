import { NextResponse, type NextRequest } from "next/server";
import { validateMintAddress } from "@/lib/solana/address";
import { acquireActivity } from "@/lib/activity/acquire";
import { activityStore } from "@/lib/activity/store";
import { ACTIVITY_VERSION } from "@/lib/activity/policy";
import type { ActivitySnapshot } from "@/lib/activity/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const pending = new Map<string, Promise<ActivitySnapshot>>();
const headers = { "Cache-Control": "private, no-store", "X-Activity-Version": ACTIVITY_VERSION };

/** Separate on-demand endpoint: cannot mutate or delay the scored report. */
export async function GET(request: NextRequest) {
  const validation = validateMintAddress(request.nextUrl.searchParams.get("address") ?? "");
  if (!validation.valid) return NextResponse.json({ error: validation.reason }, { status: 400, headers });
  const mint = validation.address;
  const snapshotId = request.nextUrl.searchParams.get("snapshot");
  const signature = request.nextUrl.searchParams.get("signature");
  if (snapshotId) {
    const snapshot = activityStore.snapshot(snapshotId, Date.now());
    if (!snapshot || snapshot.result.mint !== mint || !signature || !Object.hasOwn(snapshot.raw, signature)) {
      return NextResponse.json({ error: "Raw evidence expired, was evicted, or is unavailable on this instance. Re-run activity acquisition." }, { status: 410, headers });
    }
    return NextResponse.json({ version: ACTIVITY_VERSION, snapshotId, signature, fetchedAt: snapshot.result.fetchedAt, evidence: snapshot.raw[signature] }, { headers });
  }
  const cached = activityStore.latest(mint, Date.now());
  if (cached) return NextResponse.json(cached.result, { headers: { ...headers, "X-Activity-Cache": "hit" } });
  let work = pending.get(mint);
  if (!work) {
    // Per-instance guard. Not a distributed/global rate limiter.
    if (pending.size >= 2) return NextResponse.json({ error: "Activity acquisition is busy; retry later. Existing risk report is unaffected." }, { status: 429, headers });
    work = acquireActivity(mint, { apiKey: process.env.HELIUS_API_KEY });
    pending.set(mint, work);
  }
  try {
    const snapshot = await work;
    activityStore.put(snapshot);
    return NextResponse.json(snapshot.result, { headers: { ...headers, "X-Activity-Cache": "miss" } });
  } finally { pending.delete(mint); }
}
