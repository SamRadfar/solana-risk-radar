import type { MarketData, MarketPair, MarketValidation, ValidatedMetric } from "./types";
import { MARKET_ALGORITHM_VERSION } from "./policy";
import { validateMarket } from "./validation";
import { fresh } from "./consensus";
/** Old/missing validation envelopes fail closed, including stale cached schemas. */
export function validationOf(m: MarketData): MarketValidation {
  return m.validation?.version === MARKET_ALGORITHM_VERSION ? m.validation : validateMarket("", [], [], 0, null);
}
export function metricValue(metric: ValidatedMetric): number | null {
  return metric.status === "validated" && metric.value !== null && Number.isFinite(metric.value) ? metric.value : null;
}
export const spotPrice = (m: MarketData) => metricValue(validationOf(m).price);
/** Display only. Canonical accessors and risk rules never consult this quote. */
export function contextualQuote(m: MarketData) {
  const v = validationOf(m);
  const sources = v.price.sources.filter(s => s.value !== null && Number.isFinite(s.value) && s.value > 0 && fresh(s.fetchedAt, v.evaluatedAt));
  return v.status === "single_source" && v.price.status === "single_source" && sources.length === 1
    ? { priceUsd: sources[0].value!, provider: sources[0].provider, fetchedAt: sources[0].fetchedAt } : null;
}
/** A report cache hit cannot extend the original market evidence's freshness. */
export function marketEvidenceFresh(v: MarketValidation, now: number): boolean {
  return v.version === MARKET_ALGORITHM_VERSION && fresh(v.evaluatedAt, now) &&
    v.providers.every(p => fresh(p.fetchedAt, now) && (!p.token || fresh(p.token.fetchedAt, now)) && p.observations.filter(o => o.accepted)
      .every(o => fresh(o.fetchedAt, now) && (o.providerUpdatedAt === null || fresh(o.providerUpdatedAt, now))));
}
export const priceChange24h = (m: MarketData) => metricValue(validationOf(m).change24h);
export const totalLiquidity = (m: MarketData) => metricValue(validationOf(m).liquidity);
export const totalVolume24h = (m: MarketData) => metricValue(validationOf(m).volume24h);
export const marketCap = (m: MarketData, totalSupplyUi?: number): number | null => {
  const v = validationOf(m);
  if (totalSupplyUi !== undefined && v.circulatingSupply !== null && v.circulatingSupply > totalSupplyUi * 1.02) return null;
  return metricValue(v.marketCap);
};
export const fullyDilutedValuation = (m: MarketData, totalSupplyUi: number) =>
  validationOf(m).totalSupplyUi === totalSupplyUi ? metricValue(validationOf(m).fdv) : null;
export const pairsByLiquidity = (m: MarketData): MarketPair[] =>
  spotPrice(m) === null || totalLiquidity(m) === null ? [] : [...validationOf(m).pairs].sort((a,b) => b.liquidityUsd-a.liquidityUsd || (a.pairAddress ?? "").localeCompare(b.pairAddress ?? ""));
export const canonicalPair = (m: MarketData): { pairAddress: string; dexId: string } | null => validationOf(m).historyPool;
export const marketIdentity = (m: MarketData) =>
  pairsByLiquidity(m).find(p => p.info.imageUrl || p.info.websites.length || p.info.socials.length)?.info ??
  { imageUrl: null, websites: [], socials: [] };
