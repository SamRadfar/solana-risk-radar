import type { ObservationDecision, ProviderOpinion, ProviderSnapshot, TokenReference } from "./types";
import { agrees, relativeDifference, MAX_SNAPSHOT_AGE_MS, MIN_OBSERVATION_LIQUIDITY_USD, NATIVE_USD_TOLERANCE, POOL_CLUSTER_TOLERANCE, CHANGE_AGREEMENT_TOLERANCE, CIRCULATION_AGREEMENT_TOLERANCE } from "./policy";

export function median(values: number[]): number | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = Math.floor(v.length / 2);
  return v.length % 2 ? v[i] : v[i - 1] / 2 + v[i] / 2;
}
export function spread(values: number[]): number | null {
  return values.length ? relativeDifference(Math.min(...values), Math.max(...values)) : null;
}
export function fresh(at: number, now: number): boolean {
  return Number.isFinite(at) && at <= now + 1000 && now - at <= MAX_SNAPSHOT_AGE_MS;
}
function measurement(values: number[], tolerance: number) {
  return { value: median(values), conflict: values.length > 1 && !agrees(Math.min(...values), Math.max(...values), tolerance) };
}

/**
 * No USD-liquidity voting. A quote dependency contributes one group opinion.
 * Incompatible credible clusters remain a conflict even when a minority has
 * fewer pools. Counter-price evidence may veto a contradictory USD conversion,
 * but cannot add an independent vote or manufacture a replacement USD price.
 */
export function providerConsensus(snapshot: ProviderSnapshot, references: TokenReference[], now: number): ProviderOpinion {
  const counts = new Map<string, number>();
  const rows = [...snapshot.observations.map(o => ({ o, lookup: false })), ...(snapshot.lookups ?? []).map(o => ({ o, lookup: true }))];
  for (const { o } of rows) if (o.pairAddress) counts.set(o.pairAddress, (counts.get(o.pairAddress) ?? 0) + 1);
  const observations: ObservationDecision[] = rows.map(({ o, lookup }): ObservationDecision => {
    const refs = references.filter(r => r.provider !== snapshot.provider && r.mint === o.counterMint && fresh(r.fetchedAt, now) && r.priceUsd > 0);
    const referencePrices = refs.map(r => r.priceUsd);
    // Conflicting counter references cannot manufacture an intermediate USD conversion.
    const counter = referencePrices.length && agrees(Math.min(...referencePrices), Math.max(...referencePrices)) ? median(referencePrices) : null;
    const expected = counter !== null && o.requestedNativeRatio !== null ? counter * o.requestedNativeRatio : null;
    const disagreement = expected !== null && o.priceUsd !== null ? relativeDifference(expected, o.priceUsd) : null;
    const nativeConflict = disagreement !== null && !agrees(expected!, o.priceUsd!, NATIVE_USD_TOLERANCE);
    const internalExpected = o.reportedCounterPriceUsd && o.requestedNativeRatio
      ? o.reportedCounterPriceUsd * o.requestedNativeRatio : null;
    const internallyInconsistent = internalExpected !== null && o.priceUsd !== null &&
      !agrees(internalExpected, o.priceUsd, NATIVE_USD_TOLERANCE);
    const rejection = !snapshot.available ? "Provider unavailable" :
      o.provider !== snapshot.provider || o.requestedMint !== snapshot.mint ? "Snapshot identity mismatch" :
      o.identityError ?? (!o.side || !o.counterMint || !o.pairAddress ? "Identity or orientation missing" :
      !fresh(o.fetchedAt, now) || (o.providerUpdatedAt !== null && !fresh(o.providerUpdatedAt, now)) ? "Stale observation" :
      o.priceUsd === null || !Number.isFinite(o.priceUsd) || o.priceUsd <= 0 ? "Unusable requested-token USD price" :
      o.liquidityUsd === null || !Number.isFinite(o.liquidityUsd) || o.liquidityUsd < MIN_OBSERVATION_LIQUIDITY_USD ? "Depth missing or below observation floor" :
      (counts.get(o.pairAddress) ?? 0) > 1 ? "Duplicate pool identity; all copies quarantined" :
      internallyInconsistent ? "Provider USD fields and native ratio are internally inconsistent" :
      nativeConflict ? "Native ratio contradicts independent counter-asset USD evidence" :
      o.volume24hUsd === 0 ? "Zero reported 24h volume; current traded price unproven" : null);
    return { ...o, accepted: rejection === null, rejection, ...(lookup ? { lookup: true } : {}), weight: 0, correlationKey: snapshot.provider + ":" + (o.counterMint ?? "unknown"),
      nativeCheck: { status: disagreement === null ? "unavailable" : nativeConflict ? "conflict" : "consistent", referenceProvider: refs.map(r => r.provider).sort().join(",") || null, counterPriceUsd: counter, expectedPriceUsd: expected, disagreement } };
  }).sort((a, b) => (a.pairAddress ?? "").localeCompare(b.pairAddress ?? "") || JSON.stringify(a).localeCompare(JSON.stringify(b)));

  // By-address lookups corroborate pools listed by another provider; they never vote on price.
  const accepted = observations.filter(o => o.accepted && !o.lookup);
  // Complete-range clusters expose competing ranges, never elect a row-count winner.
  const clusters: ProviderOpinion["clusters"] = [];
  for (const o of [...accepted].sort((a,b) => a.priceUsd! - b.priceUsd! || a.pairAddress!.localeCompare(b.pairAddress!))) {
    let cluster = clusters.at(-1);
    if (!cluster || !agrees(cluster.min, o.priceUsd!, POOL_CLUSTER_TOLERANCE)) {
      cluster = { min: o.priceUsd!, max: o.priceUsd!, dependencies: [], pools: [] };
      clusters.push(cluster);
    }
    cluster.max = o.priceUsd!;
    if (!cluster.dependencies.includes(o.counterMint!)) cluster.dependencies.push(o.counterMint!);
    cluster.pools.push(o.pairAddress!);
  }
  const keys = [...new Set(accepted.map(o => o.counterMint!))].sort();
  const groups = keys.map(counterMint => {
    const rows = accepted.filter(o => o.counterMint === counterMint);
    for (const row of rows) row.weight = 1 / rows.length;
    const prices = rows.map(o => o.priceUsd!);
    return { counterMint, count: rows.length, priceUsd: median(prices)!, conflict: !agrees(Math.min(...prices), Math.max(...prices), POOL_CLUSTER_TOLERANCE) };
  });
  // Token endpoints often select a top pool; they are NOT another source.
  const token = snapshot.token?.mint === snapshot.mint && fresh(snapshot.token.fetchedAt, now) ? snapshot.token : null;
  const candidates = groups.map(g => g.priceUsd);
  if (token) candidates.push(token.priceUsd);
  const conflict = groups.some(g => g.conflict) || (candidates.length > 1 && !agrees(Math.min(...candidates), Math.max(...candidates), POOL_CLUSTER_TOLERANCE));
  const usable = snapshot.available && fresh(snapshot.fetchedAt, now) && candidates.length > 0;
  // Group medians, then an equal-group median. Presence/count of pools never
  // resolves a conflict, and extra pools on another DEX confer no independence.
  const priceUsd = usable && !conflict ? median(groups.length ? groups.map(g => g.priceUsd) : candidates) : null;
  for (const o of observations) if (o.lookup && o.accepted && (priceUsd === null || !agrees(o.priceUsd!, priceUsd, POOL_CLUSTER_TOLERANCE))) {
    o.accepted = false;
    o.rejection = "Looked-up pool price disagrees with this provider's own consensus";
  }
  const changes = measurement(accepted.filter(o => o.priceChange24h !== null && o.priceChange24h > -100)
    .map(o => 1 + o.priceChange24h! / 100), CHANGE_AGREEMENT_TOLERANCE);
  const supplies = accepted.filter(o => o.marketCap !== null).map(o => o.marketCap! / o.priceUsd!);
  if (token?.marketCap) supplies.push(token.marketCap / token.priceUsd);
  const circulation = measurement(supplies, CIRCULATION_AGREEMENT_TOLERANCE);
  return { provider: snapshot.provider, mint: snapshot.mint, available: snapshot.available, fetchedAt: snapshot.fetchedAt,
    status: !usable ? "unavailable" : conflict ? "conflict" : "usable", priceUsd, token, candidatePrices: [...candidates].sort((a,b) => a-b), clusters,
    priceChange24h: priceUsd !== null && !changes.conflict && changes.value !== null ? (changes.value - 1) * 100 : null,
    changeConflict: changes.conflict, impliedCirculating: priceUsd !== null && !circulation.conflict ? circulation.value : null,
    circulationConflict: circulation.conflict, dispersion: spread(candidates), groups, observations, errors: [...snapshot.errors] };
}
