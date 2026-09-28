import type { ClusterDecision, ObservationDecision, ProviderOpinion, ProviderSnapshot, TokenReference } from "./types";
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

/** Rows a cross-provider cluster decision removed from this provider's price vote. */
export interface ClusterQuarantine {
  pools: Set<string>;
  token: boolean;
  /**
   * Center of the one market corroborated across providers. Sub-clusters that
   * are all members of that market are not an internal conflict; each candidate
   * must instead agree with this center (existing cluster tolerance).
   */
  marketCenter?: number;
}
export const QUARANTINE_REASON = "Price cluster quarantined: not corroborated by any independent provider";

/**
 * No USD-liquidity voting. A quote dependency contributes one group opinion.
 * Incompatible credible clusters remain a conflict even when a minority has
 * fewer pools. Counter-price evidence may veto a contradictory USD conversion,
 * but cannot add an independent vote or manufacture a replacement USD price.
 */
export function providerConsensus(snapshot: ProviderSnapshot, references: TokenReference[], now: number, quarantine?: ClusterQuarantine): ProviderOpinion {
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
      o.volume24hUsd === 0 ? "Zero reported 24h volume; current traded price unproven" :
      !lookup && quarantine?.pools.has(o.pairAddress) ? QUARANTINE_REASON : null);
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
  const token = snapshot.token?.mint === snapshot.mint && fresh(snapshot.token.fetchedAt, now) && !quarantine?.token ? snapshot.token : null;
  const candidates = groups.map(g => g.priceUsd);
  if (token) candidates.push(token.priceUsd);
  const conflict = quarantine?.marketCenter !== undefined
    ? candidates.some(c => !agrees(c, quarantine.marketCenter!, POOL_CLUSTER_TOLERANCE))
    : groups.some(g => g.conflict) || (candidates.length > 1 && !agrees(Math.min(...candidates), Math.max(...candidates), POOL_CLUSTER_TOLERANCE));
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

/** Median price of a cluster's accepted, provider-listed rows. */
function clusterCenter(opinion: ProviderOpinion, pools: string[]): number | null {
  return median(opinion.observations.filter(o => o.accepted && !o.lookup && pools.includes(o.pairAddress!)).map(o => o.priceUsd!));
}

/**
 * Cross-provider cluster corroboration. A provider's price cluster is
 * corroborated only when a DIFFERENT provider's pool-based cluster agrees with
 * it (existing cluster tolerance). Pool count, liquidity and token endpoints
 * never corroborate. Outcomes:
 * - corroborated clusters form ONE compatible market: every uncorroborated
 *   cluster (and a token-endpoint price outside that market) is quarantined and
 *   cannot vote, enter a median or invalidate the corroborated market;
 * - corroborated clusters form SEVERAL incompatible markets: conflict, as before;
 * - nothing corroborated (including a single provider): unchanged behaviour.
 */
export function crossProviderClusters(opinions: ProviderOpinion[]): ClusterDecision {
  const eligible = opinions.filter(p => p.status !== "unavailable").sort((a, b) => a.provider.localeCompare(b.provider));
  const clusters = eligible.flatMap(p => p.clusters.map(c => ({ provider: p.provider, min: c.min, max: c.max, pools: c.pools, center: clusterCenter(p, c.pools) })))
    .filter((c): c is typeof c & { center: number } => c.center !== null).sort((a, b) => a.provider.localeCompare(b.provider) || a.min - b.min);
  const corroborated = clusters.filter(c => clusters.some(d => d.provider !== c.provider && agrees(c.center, d.center, POOL_CLUSTER_TOLERANCE)));
  const describe = ({ provider, min, max, pools }: typeof clusters[number]) => ({ provider, min, max, pools });
  const none: ClusterDecision = { status: "not-applicable", market: null, corroborated: [], quarantined: [], quarantinedTokens: [],
    reason: "No price cluster is corroborated by an independent provider; per-provider consensus applies unchanged" };
  if (!corroborated.length) return none;
  const markets: { first: number; members: typeof corroborated }[] = [];
  for (const c of [...corroborated].sort((a, b) => a.center - b.center)) {
    const market = markets.at(-1);
    if (market && agrees(market.first, c.center, POOL_CLUSTER_TOLERANCE)) market.members.push(c);
    else markets.push({ first: c.center, members: [c] });
  }
  // Underlying-market independence: two APIs reading the SAME physical pool
  // corroborate that pool's data, not a separately diversified market.
  // - A market is INDEPENDENTLY DIVERSIFIED only when at least two distinct
  //   physical pools in it are each read by more than one provider.
  // - A conflicting range may be quarantined only when it is ONE physical pool
  //   (however many APIs index it) and exactly one diversified market exists.
  // Anything else stays a conflict. Counts never pick a winner beyond these
  // evidence-quality definitions.
  const poolDepth = (pool: string) => median(eligible.flatMap(p => p.observations
    .filter(o => o.accepted && !o.lookup && o.pairAddress === pool).map(o => o.liquidityUsd ?? 0))) ?? 0;
  const support = markets.map(m => {
    const pools = [...new Set(m.members.flatMap(c => c.pools))].sort();
    const crossRead = pools.filter(pool => new Set(m.members.filter(c => c.pools.includes(pool)).map(c => c.provider)).size >= 2);
    return { market: m, pools, crossRead, depth: pools.reduce((sum, pool) => sum + poolDepth(pool), 0) };
  });
  let main = markets[0], duplicatedPools: string[] = [];
  if (markets.length > 1) {
    const conflict = (reason: string): ClusterDecision => ({ ...none, status: "corroborated-conflict", corroborated: corroborated.map(describe), reason });
    const diversified = support.filter(s => s.crossRead.length >= 2);
    if (diversified.length > 1) return conflict("Incompatible price ranges are each supported by independent pools read by more than one provider");
    if (!diversified.length) return conflict("Incompatible price ranges are each corroborated across providers, and no range is independently diversified");
    const independent = diversified[0], others = support.filter(s => s !== independent);
    if (others.some(s => s.pools.length > 1)) return conflict("A conflicting price range is supported by more than one physical pool; it is treated as an independent market");
    // Conservative veto, never a winner-maker: a single pool holding at least as
    // much depth as the diversified market is not discarded as an outlier.
    if (others.some(s => s.depth >= independent.depth)) return conflict("A single-pool price range holds at least as much liquidity as the diversified market; it is not quarantined");
    main = independent.market;
    duplicatedPools = others.flatMap(s => s.pools);
  }
  const members = main.members, center = median(members.map(m => m.center))!;
  const quarantined = clusters.filter(c => !members.includes(c)).map(describe);
  const quarantinedTokens = eligible.filter(p => p.token && !agrees(p.token.priceUsd, center, POOL_CLUSTER_TOLERANCE)).map(p => p.provider);
  return { status: "single-market", market: { min: Math.min(...members.map(m => m.min)), max: Math.max(...members.map(m => m.max)), center },
    corroborated: members.map(describe), quarantined, quarantinedTokens, duplicatedPools,
    reason: duplicatedPools.length
      ? "One independently diversified price range is corroborated across providers; a conflicting range backed only by a single physical pool indexed by several providers is quarantined, as are uncorroborated clusters"
      : quarantined.length || quarantinedTokens.length
      ? "One price range is corroborated across providers; uncorroborated single-provider clusters are quarantined as outliers"
      : "One price range is corroborated across providers" };
}
