import type { MarketValidation, ProviderOpinion, ProviderSnapshot, TokenReference, ValidatedMetric, MetricEvidence, MarketPair, PriceHistory, ValidationState } from "./types";
import { median, providerConsensus } from "./consensus";
import { agrees, relativeDifference, MARKET_ALGORITHM_VERSION, PRICE_AGREEMENT_TOLERANCE, CIRCULATION_AGREEMENT_TOLERANCE, CHANGE_AGREEMENT_TOLERANCE, DEPTH_AGREEMENT_TOLERANCE, ACTIVITY_AGREEMENT_TOLERANCE, MAX_HISTORY_AGE_MS } from "./policy";

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

/** Pure: the caller supplies time, snapshots and on-chain UI supply. */
export function validateMarket(mint: string, snapshots: ProviderSnapshot[], references: TokenReference[], now: number, totalSupplyUi: number | null): MarketValidation {
  const providers = snapshots.map(s => providerConsensus(s, references, now)).sort((a,b) => a.provider.localeCompare(b.provider));
  const priceSources = evidence(providers, p => p.priceUsd);
  let price = compareMetric(priceSources);
  if (snapshots.some(s => s.mint !== mint) || new Set(providers.map(p => p.provider)).size !== providers.length)
    price = withheld("conflict", "Duplicate provider or requested-mint mismatch", priceSources);
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
  const addresses = [...new Set(usable.flatMap(p => p.observations.filter(o => o.accepted).map(o => o.pairAddress!)))].sort();
  const pairs: MarketPair[] = [], poolDecisions: MarketValidation["poolDecisions"] = [];
  const metricPools: { liquidity: number[]; volume: number[]; activity: number[] } = { liquidity: [], volume: [], activity: [] };
  for (const pairAddress of addresses) {
    const rows = usable.flatMap(p => p.observations.filter(o => o.accepted && o.pairAddress === pairAddress));
    const poolsAgree = rows.length >= 2 && new Set(rows.map(o => o.provider)).size === rows.length &&
      new Set(rows.map(o => [o.baseAddress, o.quoteAddress].sort().join(":"))).size === 1;
    const metric = (read: (o: typeof rows[number]) => number | null, tolerance: number) =>
      poolsAgree ? compareMetric(rows.map(o => ({ provider: o.provider, value: read(o), fetchedAt: o.fetchedAt })), tolerance) : withheld("unavailable", "Pool lacks independent identity match");
    const depth = metric(o => o.liquidityUsd, DEPTH_AGREEMENT_TOLERANCE);
    const volume = metric(o => o.volume24hUsd, ACTIVITY_AGREEMENT_TOLERANCE);
    const buys = metric(o => o.buys24h, ACTIVITY_AGREEMENT_TOLERANCE);
    const sells = metric(o => o.sells24h, ACTIVITY_AGREEMENT_TOLERANCE);
    const accepted = price.value !== null && depth.value !== null;
    poolDecisions.push({ pairAddress, accepted, reason: accepted ? "Pool reserve corroborated across providers" : depth.reason, liquidity: depth, volume24h: volume, buys, sells });
    if (accepted) {
      const o = rows[0];
      metricPools.liquidity.push(depth.value!);
      if (volume.value !== null) metricPools.volume.push(volume.value);
      if (buys.value !== null && sells.value !== null) metricPools.activity.push(buys.value + sells.value);
      pairs.push({ pairAddress, dexId: o.dexId, quoteSymbol: o.side === "base" ? o.quoteSymbol : o.baseSymbol,
        liquidityUsd: depth.value!, volume24hUsd: volume.value, buys24h: buys.value, sells24h: sells.value,
        priceUsd: price.value, marketCap: marketCap.value, fdv: fdv.value, priceChange24h: change24h.value,
        pairCreatedAt: rows.every(r => r.pairCreatedAt !== null && r.pairCreatedAt > 0 && r.pairCreatedAt <= now) ? Math.max(...rows.map(r => r.pairCreatedAt!)) : null,
        url: "https://dexscreener.com/solana/" + pairAddress, info: rows.find(r => r.info.imageUrl || r.info.websites.length)?.info ?? o.info });
    }
  }
  const aggregate = (values: number[], label: string, fields: ("liquidity" | "volume24h" | "buys" | "sells")[]): ValidatedMetric => values.length && values.length === pairs.length
    ? { status: "validated", value: values.reduce((a,b) => a+b, 0), reason: label + " across the same independently corroborated pool subset", sources: evidence(usable, p => poolDecisions.filter(d => d.accepted).reduce((sum,d) => sum + fields.reduce((n,f) => n + (d[f].sources.find(s => s.provider === p.provider)?.value ?? 0), 0), 0)), disagreement: null }
    : withheld(poolDecisions.some(d => fields.some(f => d[f].status === "conflict")) ? "conflict" : "unavailable", "No complete independently corroborated " + label + " measurement");
  const liquidity = aggregate(metricPools.liquidity, "reserves", ["liquidity"]), volume24h = aggregate(metricPools.volume, "24h volume", ["volume24h"]), activity = aggregate(metricPools.activity, "24h trades", ["buys", "sells"]);
  if (price.value === null) {
    marketCap = withheld(price.status as Exclude<ValidationState,"validated">, "Price is not independently validated", marketCap.sources);
    fdv = withheld(price.status as Exclude<ValidationState,"validated">, "Price is not independently validated", fdv.sources);
    change24h = withheld(price.status as Exclude<ValidationState,"validated">, "Price valuation unresolved; 24h return withheld", change24h.sources);
  }
  for (const m of [marketCap, fdv]) if (m.value !== null && !Number.isFinite(m.value)) Object.assign(m, withheld("unavailable", "Derived valuation is not finite", m.sources));
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
    liquidity: block(v.liquidity), volume24h: block(v.volume24h), activity: block(v.activity), pairs: [],
    poolDecisions: v.poolDecisions.map(p => ({ ...p, accepted: false, reason })),
    historyCheck: { status: "conflict", reason, disagreement } };
}
