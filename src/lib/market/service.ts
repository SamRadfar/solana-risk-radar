import { getDexScreenerSnapshot } from "../providers/dexscreener";
import { getGeckoPoolsByAddress, getGeckoReferences, getGeckoSnapshot } from "../providers/gecko-market";
import { getPriceHistory } from "../providers/geckoterminal";
import { MAX_POOL_LOOKUPS, MAX_QUOTE_REFERENCES, MIN_OBSERVATION_LIQUIDITY_USD } from "./policy";
import { validateMarket, withHistory } from "./validation";
import type { MarketData } from "./types";

/** Network orchestration stays outside pure validation and the risk engine. */
export async function getMarketData(mint: string, totalSupplyUi: number | null): Promise<MarketData> {
  const [dex, gecko] = await Promise.all([getDexScreenerSnapshot(mint), getGeckoSnapshot(mint)]);
  const counters = [...new Set(dex.observations.filter(o => !o.identityError && o.counterMint).map(o => o.counterMint!))]
    .sort().slice(0, MAX_QUOTE_REFERENCES);
  const { references, error } = await getGeckoReferences(counters);
  let validation = validateMarket(mint, [dex, gecko], references, Date.now(), totalSupplyUi);
  // Providers list different pool subsets; for USDC they can be disjoint, so no
  // pool is corroborated at all. Only then, look up DexScreener-listed pools on
  // GeckoTerminal by address (one bounded request; GeckoTerminal rate-limits
  // tightly, so it is not spent when pools already overlap). Lookup rows never
  // vote on price, so this second pass cannot change the validated price.
  if (validation.price.status === "validated" && validation.liquidity.status !== "validated") {
    const listedByGecko = new Set(gecko.observations.map(o => o.pairAddress));
    const lookupTargets = [...new Set(dex.observations
      .filter(o => !o.identityError && o.pairAddress && !listedByGecko.has(o.pairAddress) && (o.liquidityUsd ?? 0) >= MIN_OBSERVATION_LIQUIDITY_USD)
      .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0) || a.pairAddress!.localeCompare(b.pairAddress!))
      .map(o => o.pairAddress!))].slice(0, MAX_POOL_LOOKUPS);
    if (lookupTargets.length) {
      const lookup = await getGeckoPoolsByAddress(mint, lookupTargets);
      validation = validateMarket(mint, [dex, { ...gecko, lookups: lookup.observations }], references, Date.now(), totalSupplyUi);
      validation.poolLookup = { requested: lookupTargets.length, returned: lookup.observations.length, error: lookup.error };
    }
  }
  validation.counterReferences = { requestedMints: counters, observations: references, error };
  if (validation.historyPool) {
    const history = await getPriceHistory(mint, validation.historyPool.pairAddress);
    validation = withHistory(validation, history, Date.now());
  }
  const identity = validation.providers.flatMap(p => p.observations).find(o => o.accepted);
  return { available: dex.available || gecko.available, pairs: validation.pairs, validation,
    name: identity ? (identity.side === "base" ? identity.baseName : identity.quoteName) ?? null : null, symbol: identity ? identity.side === "base" ? identity.baseSymbol : identity.quoteSymbol : null,
    imageUrl: null, websites: [], socials: [],
    ...(validation.price.value === null ? { error: validation.price.reason } : {}) };
}
