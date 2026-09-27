import type { MarketData, MarketPair, MarketValidation, ValidatedMetric } from "./types";
import { MARKET_ALGORITHM_VERSION } from "./policy";
import { validateMarket } from "./validation";
/** Old/missing validation envelopes fail closed, including stale cached schemas. */
export function validationOf(m: MarketData): MarketValidation {
  return m.validation?.version === MARKET_ALGORITHM_VERSION ? m.validation : validateMarket("", [], [], 0, null);
}
export function metricValue(metric: ValidatedMetric): number | null {
  return metric.status === "validated" && metric.value !== null && Number.isFinite(metric.value) ? metric.value : null;
}
export const spotPrice = (m: MarketData) => metricValue(validationOf(m).price);
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
