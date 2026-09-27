import { getDexScreenerSnapshot } from "../providers/dexscreener";
import { getGeckoReferences, getGeckoSnapshot } from "../providers/gecko-market";
import { getPriceHistory } from "../providers/geckoterminal";
import { MAX_QUOTE_REFERENCES } from "./policy";
import { validateMarket, withHistory } from "./validation";
import type { MarketData } from "./types";

/** Network orchestration stays outside pure validation and the risk engine. */
export async function getMarketData(mint: string, totalSupplyUi: number | null): Promise<MarketData> {
  const [dex, gecko] = await Promise.all([getDexScreenerSnapshot(mint), getGeckoSnapshot(mint)]);
  const counters = [...new Set(dex.observations.filter(o => !o.identityError && o.counterMint).map(o => o.counterMint!))]
    .sort().slice(0, MAX_QUOTE_REFERENCES);
  const { references, error } = await getGeckoReferences(counters);
  let validation = validateMarket(mint, [dex, gecko], references, Date.now(), totalSupplyUi);
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
