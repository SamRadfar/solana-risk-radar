import type { MarketValidation, ProviderOpinion, ProviderSnapshot, TokenReference, ValidatedMetric, MetricEvidence, MarketPair, PriceHistory, ValidationState, ObservationDecision, SubsetCoverage, DayReturnCheck } from "./types";
import { crossProviderClusters, median, providerConsensus, type ClusterQuarantine } from "./consensus";
import { agrees, relativeDifference, MARKET_ALGORITHM_VERSION, PRICE_AGREEMENT_TOLERANCE, CIRCULATION_AGREEMENT_TOLERANCE, CHANGE_AGREEMENT_TOLERANCE, DEPTH_AGREEMENT_TOLERANCE, ACTIVITY_AGREEMENT_TOLERANCE, MAX_HISTORY_AGE_MS, MIN_SUBSET_LIQUIDITY_SHARE } from "./policy";

export function withheld(status: Exclude<ValidationState, "validated">, reason: string, sources: MetricEvidence[] = [], disagreement: number | null = null): ValidatedMetric {
  return { status, value: null, reason, sources, disagreement };
}
/** One vote per provider ID, with duplicate inputs rejected instead of amplified. */
export function compareMetric(sources: MetricEvidence[], tolerance = PRICE_AGREEMENT_TOLERANCE): ValidatedMetric {
  const rows = sources.filter(s => s.value !== null && Number.isFinite(s.value) && s.value >= 0);
  if (new Set(rows.map(s => s.provider)).size !== rows.length) return withheld("conflict", "Duplicate provider opinions", sources);
  if (!rows.length) return withheld("unavailable", "No usable provider measurement", sources);
  if (rows.length === 1) return withheld("single_source", "Independent corroboration unavailable", sources);
  const values = rows.map(s => s.value!);
  const disagreement = relativeDifference(Math.min(...values), Math.max(...values));
  if (!agrees(Math.min(...values), Math.max(...values), tolerance)) return withheld("conflict", "Independent providers disagree", sources, disagreement);
  return { status: "validated", value: median(values), sources, disagreement, reason: "Independent provider opinions agree" };
}
const evidence = (providers: ProviderOpinion[], read: (p: ProviderOpinion) => number | null): MetricEvidence[] =>
  providers.map(p => ({ provider: p.provider, value: read(p), fetchedAt: p.fetchedAt, reason: p.status === "usable" ? undefined : p.status }));
const pct = (x: number) => x < 1 && x >= 0.9995 ? ">99.9%" : (x * 100).toFixed(1) + "%";
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Liquidity-weighted median: the value at which half of the weight lies on each side. */
export function weightedMedian(rows: { value: number; weight: number }[]): number | null {
  const sorted = rows.filter(r => Number.isFinite(r.value) && r.weight > 0).sort((a, b) => a.value - b.value);
  const total = sum(sorted.map(r => r.weight));
  let running = 0;
  for (const row of sorted) { running += row.weight; if (running >= total / 2) return row.value; }
  return null;
}

type PoolDecision = MarketValidation["poolDecisions"][number];
/**
 * Metric-specific subset measurement. A pool whose providers disagree on (or
 * lack) THIS metric is excluded from THIS metric only; its reserves, identity
 * and other metrics are unaffected. The subset is published only when it holds
 * a strict majority of corroborated reserves, and its coverage is disclosed.
 */
function subsetMeasurement(decisions: PoolDecision[], label: string, fields: ("volume24h" | "buys" | "sells")[]):
  { measured: PoolDecision[]; coverage: SubsetCoverage | null; withheldAs: ValidatedMetric | null } {
  const accepted = decisions.filter(d => d.accepted);
  const measured = accepted.filter(d => fields.every(f => d[f].status === "validated" && d[f].value !== null));
  const reserves = sum(accepted.map(d => d.liquidity.value ?? 0)), measuredReserves = sum(measured.map(d => d.liquidity.value ?? 0));
  const excluded = accepted.filter(d => !measured.includes(d)).map(d => {
    const failed = fields.map(f => d[f]).find(m => m.status !== "validated")!;
    return { pairAddress: d.pairAddress, reason: `${failed.status}: ${failed.reason}` };
  });
  const coverage: SubsetCoverage | null = accepted.length ? { poolsMeasured: measured.length, poolsCorroborated: accepted.length,
    liquidityUsd: measuredReserves, liquidityShare: reserves > 0 ? measuredReserves / reserves : 0, excluded } : null;
  if (!accepted.length) return { measured, coverage, withheldAs: withheld("unavailable", "No independently corroborated pool") };
  if (!measured.length || coverage!.liquidityShare <= MIN_SUBSET_LIQUIDITY_SHARE) {
    const conflict = accepted.some(d => fields.some(f => d[f].status === "conflict"));
    return { measured, coverage, withheldAs: withheld(conflict ? "conflict" : "unavailable", measured.length
      ? `Validated ${label} covers only ${pct(coverage!.liquidityShare)} of corroborated reserves (${measured.length} of ${accepted.length} pools); a majority is required`
      : `No corroborated pool has independently validated ${label}`) };
  }
  return { measured, coverage, withheldAs: null };
}
function subsetReason(label: string, c: SubsetCoverage): string {
  return c.poolsMeasured === c.poolsCorroborated
    ? `${label} across the same independently corroborated pool subset`
    : `${label} validated on ${c.poolsMeasured} of ${c.poolsCorroborated} corroborated pools holding ${pct(c.liquidityShare)} of corroborated reserves; ${c.excluded.length} pool(s) excluded for this metric only`;
}

/** Pure: the caller supplies time, snapshots and on-chain UI supply. */
export function validateMarket(mint: string, snapshots: ProviderSnapshot[], references: TokenReference[], now: number, totalSupplyUi: number | null): MarketValidation {
  // Cross-provider cluster corroboration first: an uncorroborated single-provider
  // cluster is quarantined (re-evaluated without it) only when the corroborated
  // clusters form one compatible market. Everything else is unchanged.
  const initial = snapshots.map(s => providerConsensus(s, references, now));
  const priceClusters = crossProviderClusters(initial);
  const quarantine = new Map<string, ClusterQuarantine>();
  if (priceClusters.status === "single-market") {
    for (const q of priceClusters.quarantined) {
      const entry = quarantine.get(q.provider) ?? { pools: new Set<string>(), token: false };
      q.pools.forEach(pool => entry.pools.add(pool));
      quarantine.set(q.provider, entry);
    }
    for (const provider of priceClusters.quarantinedTokens) quarantine.set(provider, { pools: quarantine.get(provider)?.pools ?? new Set<string>(), token: true });
    // Within the one corroborated market, a provider's split into member
    // sub-clusters is not a conflict: candidates must agree with the market center.
    for (const s of snapshots) quarantine.set(s.provider, { pools: new Set<string>(), token: false, ...quarantine.get(s.provider), marketCenter: priceClusters.market!.center });
  }
  const providers = (quarantine.size ? snapshots.map(s => providerConsensus(s, references, now, quarantine.get(s.provider))) : initial)
    .sort((a,b) => a.provider.localeCompare(b.provider));
  const priceSources = evidence(providers, p => p.priceUsd);
  let price = compareMetric(priceSources);
  if (snapshots.some(s => s.mint !== mint) || new Set(providers.map(p => p.provider)).size !== providers.length)
    price = withheld("conflict", "Duplicate provider or requested-mint mismatch", priceSources);
  else if (priceClusters.status === "corroborated-conflict")
    price = withheld("conflict", priceClusters.reason, priceSources);
  else if (providers.some(p => p.status === "conflict"))
    price = withheld("conflict", "A provider contains unresolved incompatible valuation clusters", priceSources);

  const usable = providers.filter(p => p.status === "usable");
  let circulation = compareMetric(evidence(usable, p => p.impliedCirculating), CIRCULATION_AGREEMENT_TOLERANCE);
  if (usable.some(p => p.circulationConflict)) circulation = withheld("conflict", "Provider circulating-supply estimates disagree", circulation.sources);
  if (circulation.value !== null && totalSupplyUi !== null && circulation.value > totalSupplyUi * 1.02)
    circulation = withheld("conflict", "Reported circulation exceeds on-chain total supply", circulation.sources);
  let marketCap: ValidatedMetric = circulation.value !== null && price.value !== null
    ? { ...circulation, value: price.value * circulation.value, reason: "Validated price × provider-corroborated circulating supply (provider cap/price)" }
    : { ...circulation, value: null };
  let fdv: ValidatedMetric = price.value !== null && totalSupplyUi !== null && Number.isFinite(totalSupplyUi) && totalSupplyUi > 0
    ? { status: "validated", value: price.value * totalSupplyUi, reason: "Validated price × on-chain UI total supply", sources: price.sources, disagreement: price.disagreement }
    : withheld("unavailable", "Validated price and on-chain supply required");

  let change24h = compareMetric(evidence(usable, p => p.priceChange24h === null ? null : 1 + p.priceChange24h / 100), CHANGE_AGREEMENT_TOLERANCE);
  if (usable.some(p => p.changeConflict)) change24h = withheld("conflict", "Provider 24h returns disagree across pools", change24h.sources);
  change24h = { ...change24h, value: change24h.value === null ? null : (change24h.value - 1) * 100,
    sources: change24h.sources.map(s => ({ ...s, value: s.value === null ? null : (s.value - 1) * 100 })) };

  // Match actual pool identities across providers; never add two providers'
  // reserve/volume totals. This is a corroborated indexed subset, not TVL.
  // A zero-volume row cannot establish current spot, but measured zero activity
  // remains usable when independent spot evidence confirms its valuation.
  const metricEligible = (o: ObservationDecision) => o.accepted ||
    (o.rejection === "Zero reported 24h volume; current traded price unproven" && price.value !== null &&
      o.priceUsd !== null && agrees(o.priceUsd, price.value));
  const addresses = [...new Set(usable.flatMap(p => p.observations.filter(metricEligible).map(o => o.pairAddress!)))].sort();
  const pairs: MarketPair[] = [], poolDecisions: MarketValidation["poolDecisions"] = [];
  const metricPools: { liquidity: number[] } = { liquidity: [] };
  for (const pairAddress of addresses) {
    const rows = usable.flatMap(p => p.observations.filter(o => metricEligible(o) && o.pairAddress === pairAddress));
    const poolsAgree = rows.length >= 2 && new Set(rows.map(o => o.provider)).size === rows.length &&
      new Set(rows.map(o => [o.baseAddress, o.quoteAddress].sort().join(":"))).size === 1;
    const metric = (read: (o: typeof rows[number]) => number | null, tolerance: number) =>
      poolsAgree ? compareMetric(rows.map(o => ({ provider: o.provider, value: read(o), fetchedAt: o.fetchedAt })), tolerance) : withheld("unavailable", "Pool lacks independent identity match");
    const depth = metric(o => o.liquidityUsd, DEPTH_AGREEMENT_TOLERANCE);
    const volume = metric(o => o.volume24hUsd, ACTIVITY_AGREEMENT_TOLERANCE);
    const buys = metric(o => o.buys24h, ACTIVITY_AGREEMENT_TOLERANCE);
    const sells = metric(o => o.sells24h, ACTIVITY_AGREEMENT_TOLERANCE);
    const poolChange = metric(o => o.priceChange24h === null || o.priceChange24h <= -100 ? null : 1 + o.priceChange24h / 100, CHANGE_AGREEMENT_TOLERANCE);
    const accepted = price.value !== null && depth.value !== null;
    poolDecisions.push({ pairAddress, accepted, reason: accepted ? "Pool reserve corroborated across providers" : depth.reason, liquidity: depth, volume24h: volume, buys, sells, change24h: poolChange });
    if (accepted) {
      const o = rows[0];
      metricPools.liquidity.push(depth.value!);
      pairs.push({ pairAddress, dexId: o.dexId, quoteSymbol: o.side === "base" ? o.quoteSymbol : o.baseSymbol,
        liquidityUsd: depth.value!, volume24hUsd: volume.value, buys24h: buys.value, sells24h: sells.value,
        priceUsd: price.value, marketCap: marketCap.value, fdv: fdv.value, priceChange24h: change24h.value,
        pairCreatedAt: rows.every(r => r.pairCreatedAt !== null && r.pairCreatedAt > 0 && r.pairCreatedAt <= now) ? Math.max(...rows.map(r => r.pairCreatedAt!)) : null,
        url: "https://dexscreener.com/solana/" + pairAddress, info: rows.find(r => r.info.imageUrl || r.info.websites.length)?.info ?? o.info });
    }
  }
  const providerSums = (decisions: PoolDecision[], fields: ("liquidity" | "volume24h" | "buys" | "sells")[]) =>
    evidence(usable, p => decisions.reduce((total, d) => total + fields.reduce((n, f) => n + (d[f].sources.find(s => s.provider === p.provider)?.value ?? 0), 0), 0));
  // Reserves are measured on every corroborated pool (acceptance requires validated depth).
  const liquidity: ValidatedMetric = metricPools.liquidity.length
    ? { status: "validated", value: sum(metricPools.liquidity), reason: "reserves across the same independently corroborated pool subset", sources: providerSums(poolDecisions.filter(d => d.accepted), ["liquidity"]), disagreement: null }
    : withheld(poolDecisions.some(d => d.liquidity.status === "conflict") ? "conflict" : "unavailable", "No complete independently corroborated reserves measurement");
  const volumeSubset = subsetMeasurement(poolDecisions, "24h volume", ["volume24h"]);
  const volume24h: ValidatedMetric = volumeSubset.withheldAs ?? { status: "validated", value: sum(volumeSubset.measured.map(d => d.volume24h.value!)),
    reason: subsetReason("24h volume", volumeSubset.coverage!), sources: providerSums(volumeSubset.measured, ["volume24h"]), disagreement: null };
  const activitySubset = subsetMeasurement(poolDecisions, "24h trade counts", ["buys", "sells"]);
  const activity: ValidatedMetric = activitySubset.withheldAs ?? { status: "validated", value: sum(activitySubset.measured.map(d => d.buys.value! + d.sells.value!)),
    reason: subsetReason("24h trades", activitySubset.coverage!), sources: providerSums(activitySubset.measured, ["buys", "sells"]), disagreement: null };

  // 24h return fallback. Providers can disagree only because their pool mixes
  // differ (e.g. one thin pool with a stale prior price). Use same-pool returns
  // corroborated across providers, weighted by corroborated depth; publish only
  // when the pools agreeing with that value (unchanged tolerance) hold a strict
  // majority of corroborated reserves. Otherwise the original withholding stands.
  let change24hSubset: SubsetCoverage | null = null;
  if (price.value !== null && change24h.status !== "validated") {
    const accepted = poolDecisions.filter(d => d.accepted);
    const reserves = sum(accepted.map(d => d.liquidity.value!));
    const withReturn = accepted.filter(d => d.change24h.status === "validated" && d.change24h.value !== null);
    const center = weightedMedian(withReturn.map(d => ({ value: d.change24h.value!, weight: d.liquidity.value! })));
    const agreeing = center === null ? [] : withReturn.filter(d => agrees(d.change24h.value!, center, CHANGE_AGREEMENT_TOLERANCE));
    const share = reserves > 0 ? sum(agreeing.map(d => d.liquidity.value!)) / reserves : 0;
    if (center !== null && share > MIN_SUBSET_LIQUIDITY_SHARE) {
      change24hSubset = { poolsMeasured: agreeing.length, poolsCorroborated: accepted.length, liquidityUsd: sum(agreeing.map(d => d.liquidity.value!)), liquidityShare: share,
        excluded: accepted.filter(d => !agreeing.includes(d)).map(d => ({ pairAddress: d.pairAddress,
          reason: d.change24h.status !== "validated" ? `${d.change24h.status}: ${d.change24h.reason}` : "Same-pool return is an outlier to the depth-weighted return" })) };
      change24h = { status: "validated", value: (center - 1) * 100, disagreement: null, sources: change24h.sources,
        reason: `Depth-weighted same-pool 24h return: ${agreeing.length} of ${accepted.length} corroborated pools holding ${pct(share)} of corroborated reserves agree (provider-level: ${change24h.reason})` };
      for (const pair of pairs) pair.priceChange24h = change24h.value;
    } else if (withReturn.length) {
      change24h = { ...change24h, reason: `${change24h.reason}; corroborated same-pool returns agreeing with the depth-weighted return hold only ${pct(share)} of reserves, a majority is required` };
    }
  }
  if (price.value === null) {
    marketCap = withheld(price.status as Exclude<ValidationState,"validated">, "Price is not independently validated", marketCap.sources);
    fdv = withheld(price.status as Exclude<ValidationState,"validated">, "Price is not independently validated", fdv.sources);
    change24h = withheld(price.status as Exclude<ValidationState,"validated">, "Price valuation unresolved; 24h return withheld", change24h.sources);
  }
  for (const m of [marketCap, fdv]) if (m.value !== null && !Number.isFinite(m.value)) Object.assign(m, withheld("unavailable", "Derived valuation is not finite", m.sources));
  // Valuation hierarchy for Liquidity vs Market Cap. Never provider FDV, max
  // supply, or an invented circulating supply; never without a validated price.
  const supplyUsable = totalSupplyUi !== null && Number.isFinite(totalSupplyUi) && totalSupplyUi > 0;
  const valuation: MarketValidation["valuation"] = marketCap.status === "validated" && marketCap.value !== null
    ? { ...marketCap, basis: "circulating-market-cap" }
    : price.value !== null && supplyUsable && Number.isFinite(price.value * totalSupplyUi!)
      ? { status: "validated", value: price.value * totalSupplyUi!, basis: "on-chain-supply-valuation", sources: price.sources, disagreement: price.disagreement,
          reason: "On-chain supply valuation: validated price × current on-chain minted supply (not verified circulating market cap)" }
      : { ...withheld(price.value === null ? (price.status === "validated" ? "unavailable" : price.status as Exclude<ValidationState, "validated">) : "unavailable",
          price.value === null ? "Price is not independently validated" : "Meaningful on-chain supply is required for an on-chain supply valuation"), basis: null };
  const historyCandidate = usable.flatMap(p => p.observations).filter(o => o.provider === "geckoterminal" && o.accepted)
    .sort((a,b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0) || a.pairAddress!.localeCompare(b.pairAddress!))[0];
  const confidence = price.status === "validated"
    ? price.disagreement !== null && price.disagreement <= .02 && providers.every(p => p.errors.length === 0 && (p.dispersion ?? 1) <= .02) &&
      providers.every(p => p.observations.some(o => o.accepted && o.trustedCounterMint)) &&
      providers.some(p => p.observations.some(o => o.accepted && o.nativeCheck.status === "consistent")) ? "high" : "medium"
    : price.status === "single_source" ? "low" : "none";
  return { version: MARKET_ALGORITHM_VERSION, mint, evaluatedAt: now, status: price.status, confidence, price, marketCap, fdv, change24h,
    liquidity, volume24h, activity, providers, counterReferences: { requestedMints: [...new Set(references.map(r => r.mint))].sort(), observations: references, error: null }, pairs, poolDecisions,
    historyPool: historyCandidate ? { pairAddress: historyCandidate.pairAddress!, dexId: historyCandidate.dexId } : null,
    history: null, historyCheck: { status: "unavailable", reason: "History not checked", disagreement: null },
    volumeSubset: volumeSubset.withheldAs ? null : volumeSubset.coverage,
    activitySubset: activitySubset.withheldAs ? null : { ...activitySubset.coverage!, buys: sum(activitySubset.measured.map(d => d.buys.value!)), sells: sum(activitySubset.measured.map(d => d.sells.value!)) },
    change24hSubset, priceClusters, valuation,
    circulatingSupply: circulation.value, totalSupplyUi };
}

/** A fresh contradictory close invalidates spot-derived fields BEFORE scoring. */
export function withHistory(validation: MarketValidation, history: PriceHistory, now: number): MarketValidation {
  const v = { ...validation, history };
  const last = history.points.at(-1);
  if (history.mint !== v.mint || history.pool !== v.historyPool?.pairAddress || !history.side || !last ||
      last.t > now + 60_000 || now - last.t > MAX_HISTORY_AGE_MS || v.price.value === null) {
    return { ...v, historyCheck: { status: "unavailable", reason: history.error ?? "No fresh identified close and validated spot to compare", disagreement: null } };
  }
  const disagreement = relativeDifference(v.price.value, last.p);
  if (agrees(v.price.value, last.p)) return { ...v, historyCheck: { status: "consistent", reason: "Fresh requested-token close agrees with spot", disagreement } };
  const reason = "Fresh GeckoTerminal history contradicts provider spot consensus";
  const block = (m: ValidatedMetric) => withheld("conflict", reason, m.sources, disagreement);
  return { ...v, status: "conflict", confidence: "none", price: block(v.price), marketCap: block(v.marketCap), fdv: block(v.fdv), change24h: block(v.change24h),
    valuation: { ...block(v.valuation), basis: null },
    liquidity: block(v.liquidity), volume24h: block(v.volume24h), activity: block(v.activity), pairs: [],
    volumeSubset: null, activitySubset: null, change24hSubset: null,
    poolDecisions: v.poolDecisions.map(p => ({ ...p, accepted: false, reason })),
    historyCheck: { status: "conflict", reason, disagreement } };
}

const HOUR_MS = 60 * 60 * 1000, DAY_MS = 24 * HOUR_MS;
/** Latest hourly candle must be this recent to prove the series is current. */
const MAX_DAY_SERIES_LAG_MS = 2 * HOUR_MS;
/** Reference close must lie within this distance of exactly 24 h ago. */
const MAX_REFERENCE_OFFSET_MS = HOUR_MS;

/**
 * 24h movement fallback from requested-mint USD hourly history (GeckoTerminal
 * OHLCV requested with currency=usd&token=<mint>, so quote-side mints and
 * stablecoins are native, never inverted). Used only when no provider-level or
 * same-pool return validated. The pool must be a corroborated pool; the latest
 * candle must be recent and agree with validated spot (identity/currency proof);
 * the reference is the close nearest to exactly 24 h ago (within 1 h). A
 * same-pool provider return, when present, must agree. Otherwise unavailable.
 */
export function withDayReturn(validation: MarketValidation, history: PriceHistory, now: number): MarketValidation {
  const done = (check: DayReturnCheck, change24h = validation.change24h): MarketValidation =>
    ({ ...validation, change24h, dayReturn: check, pairs: validation.pairs.map(p => ({ ...p, priceChange24h: change24h.value })) });
  const base: DayReturnCheck = { status: "unavailable", reason: "", pool: history.pool, referenceTime: null, referencePriceUsd: null, samePoolReturn: null };
  const spot = validation.price.value;
  if (validation.change24h.status === "validated") return { ...validation, dayReturn: { ...base, status: "not-needed", reason: "Provider 24h return already validated" } };
  const append = (reason: string) => ({ ...validation.change24h, reason: `${validation.change24h.reason}; history fallback: ${reason}` });
  const fail = (reason: string, status: "unavailable" | "conflict" = "unavailable") =>
    done({ ...base, status, reason }, status === "conflict" ? withheld("conflict", `24h history contradicts same-pool provider return: ${reason}`, validation.change24h.sources) : append(reason));
  if (spot === null || validation.price.status !== "validated") return fail("validated price required");
  if (history.mint !== validation.mint || !history.side || !history.pool || !validation.pairs.some(p => p.pairAddress === history.pool)) return fail("history is not for the requested mint on a corroborated pool");
  if (history.error && !history.points.length) return fail(history.error);
  const points = [...history.points].sort((a, b) => a.t - b.t), latest = points.at(-1);
  if (!latest || now - latest.t > MAX_DAY_SERIES_LAG_MS || latest.t > now + 60_000) return fail("no recent hourly close");
  if (!agrees(latest.p, spot)) return fail("latest hourly close does not match validated spot");
  const target = now - DAY_MS;
  const reference = points.map(p => ({ ...p, offset: Math.abs(p.t + HOUR_MS - target) }))
    .filter(p => p.offset <= MAX_REFERENCE_OFFSET_MS).sort((a, b) => a.offset - b.offset || a.t - b.t)[0];
  if (!reference) return fail("no hourly close within one hour of 24 h ago");
  const gross = spot / reference.p;
  const decision = validation.poolDecisions.find(d => d.pairAddress === history.pool);
  const samePool = decision?.change24h.status === "validated" ? decision.change24h.value : null;
  const check: DayReturnCheck = { ...base, referenceTime: reference.t + HOUR_MS, referencePriceUsd: reference.p, samePoolReturn: samePool, status: "validated", reason: "" };
  if (samePool !== null && !agrees(gross, samePool, CHANGE_AGREEMENT_TOLERANCE)) return done({ ...check, status: "conflict", reason: "history-derived and same-pool provider returns disagree" },
    withheld("conflict", "24h history contradicts same-pool provider return", validation.change24h.sources, relativeDifference(gross, samePool)));
  const reason = `Validated spot vs requested-mint USD close ${new Date(reference.t + HOUR_MS).toISOString()} on corroborated pool ${history.pool}` +
    (samePool !== null ? "; same-pool provider return agrees" : "; no same-pool provider return to corroborate");
  return done({ ...check, reason }, { status: "validated", value: (gross - 1) * 100, reason, sources: validation.change24h.sources, disagreement: null });
}
