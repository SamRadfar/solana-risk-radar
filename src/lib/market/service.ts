import { getDexScreenerSnapshot } from "../providers/dexscreener";
import { geckoReferencesFromPools, getGeckoPoolsByAddress, getGeckoReferences, getGeckoSnapshot } from "../providers/gecko-market";
import { getDayPriceHistory, getPriceHistory, historyRetryAfterMs } from "../providers/geckoterminal";
import { buildChart, chartAcceptance, chartCandidates } from "./chart";
import { MAX_POOL_LOOKUPS, MAX_QUOTE_REFERENCES, MIN_OBSERVATION_LIQUIDITY_USD } from "./policy";
import { validateMarket, withDayReturn, withHistory } from "./validation";
import type { MarketData, MarketValidation, PriceHistory } from "./types";

const reused = (events: string[] | undefined) => (events ?? []).some(e => e.includes("reused a successful response"));

/**
 * Network orchestration stays outside pure validation and the risk engine.
 * Request priority (GeckoTerminal allows only a few requests per burst):
 *   1. scored price/pool evidence (DexScreener + GeckoTerminal token and pools)
 *   2. corroboration evidence only when needed (counter references not already
 *      priced by GeckoTerminal's pools; by-address pool lookup; 24h history)
 *   3. optional 4h chart context last, skipped while the provider is rate-limited.
 */
export async function getMarketData(mint: string, totalSupplyUi: number | null): Promise<MarketData> {
  const [dex, gecko] = await Promise.all([getDexScreenerSnapshot(mint), getGeckoSnapshot(mint)]);
  const counters = [...new Set(dex.observations.filter(o => !o.identityError && o.counterMint).map(o => o.counterMint!))]
    .sort().slice(0, MAX_QUOTE_REFERENCES);
  const derived = geckoReferencesFromPools(gecko.observations, counters);
  const missing = counters.filter(c => !derived.some(r => r.mint === c));
  // Providers list different pool subsets; for USDC they can be disjoint, so no
  // pool is corroborated at all. Only then, look up DexScreener-listed pools on
  // GeckoTerminal by address. The lookup decides every pool-based signal, so it
  // is requested BEFORE the counter-reference batch (a veto-only check whose
  // absence is already handled safely). Lookup rows never vote on price, and
  // the final validation below uses the same inputs whatever the fetch order.
  const preliminary = validateMarket(mint, [dex, gecko], derived, Date.now(), totalSupplyUi);
  let lookups: typeof gecko.observations = [], poolLookup: MarketValidation["poolLookup"];
  if (preliminary.price.status === "validated" && preliminary.liquidity.status !== "validated") {
    const listedByGecko = new Set(gecko.observations.map(o => o.pairAddress));
    const lookupTargets = [...new Set(dex.observations
      .filter(o => !o.identityError && o.pairAddress && !listedByGecko.has(o.pairAddress) && (o.liquidityUsd ?? 0) >= MIN_OBSERVATION_LIQUIDITY_USD)
      .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0) || a.pairAddress!.localeCompare(b.pairAddress!))
      .map(o => o.pairAddress!))].slice(0, MAX_POOL_LOOKUPS);
    if (lookupTargets.length) {
      const lookup = await getGeckoPoolsByAddress(mint, lookupTargets);
      lookups = lookup.observations;
      poolLookup = { requested: lookupTargets.length, returned: lookup.observations.length, error: lookup.error };
    }
  }
  const fetched = await getGeckoReferences(missing);
  const references = [...derived, ...fetched.references];
  let validation = validateMarket(mint, [dex, lookups.length ? { ...gecko, lookups } : gecko], references, Date.now(), totalSupplyUi);
  if (poolLookup) validation.poolLookup = poolLookup;
  const requestLog: NonNullable<MarketValidation["requestLog"]> = [
    { request: "dexscreener pools", cached: reused(dex.errors), error: dex.available ? null : dex.errors.at(-1) ?? "unavailable" },
    { request: "geckoterminal token and pools", cached: reused(gecko.errors), error: gecko.available ? null : gecko.errors.at(-1) ?? "unavailable" },
    ...(poolLookup ? [{ request: `geckoterminal pool lookup (${poolLookup.requested} pools)`, cached: false, error: poolLookup.error }] : []),
    { request: `geckoterminal counter references (${missing.length} requested, ${derived.length} from pool rows)`, cached: false, error: fetched.error },
  ];
  validation.counterReferences = { requestedMints: counters, observations: references, error: fetched.error };
  // 24h movement fallback (scored): only when no provider or same-pool return validated.
  if (validation.price.status === "validated" && validation.change24h.status !== "validated" && validation.pairs.length) {
    const pool = [...validation.pairs].sort((a, b) => b.liquidityUsd - a.liquidityUsd || (a.pairAddress ?? "").localeCompare(b.pairAddress ?? ""))[0].pairAddress!;
    const day = await getDayPriceHistory(mint, pool);
    validation = withDayReturn(validation, day, Date.now());
    requestLog.push({ request: "geckoterminal 24h requested-mint USD history", cached: reused(day.events), error: day.error ?? null });
  }
  // Optional chart context last; it never spends a rate-limited provider's budget.
  // The history contradiction check (withHistory) is unchanged and still uses
  // validation.historyPool; the chart below is display-only and separate.
  let historyPoolSeries: PriceHistory | null = null;
  if (validation.historyPool) {
    const history = await getPriceHistory(mint, validation.historyPool.pairAddress);
    historyPoolSeries = history;
    validation = withHistory(validation, history, Date.now());
    requestLog.push({ request: "geckoterminal 4h chart history (optional)", cached: reused(history.events), error: history.error ?? null });
  }
  // 4H chart: corroborated pools deepest first, reusing the series already read
  // for historyPool; stop at the first acceptable one or when the provider is
  // rate-limited (the page then retries the same pools via /api/history).
  const attempts: Parameters<typeof buildChart>[1] = [];
  for (const candidate of chartCandidates(validation)) {
    const series = candidate.pairAddress === validation.historyPool?.pairAddress && historyPoolSeries
      ? historyPoolSeries : await getPriceHistory(mint, candidate.pairAddress);
    attempts.push({ pool: candidate.pairAddress, dexId: candidate.dexId, history: series });
    const verdict = chartAcceptance(series, mint, candidate.pairAddress, validation.price.value);
    if (verdict.ok || verdict.transient) break;
  }
  validation.chart = buildChart(validation, attempts, historyRetryAfterMs());
  validation.requestLog = requestLog;
  const identity = validation.providers.flatMap(p => p.observations).find(o => o.accepted);
  return { available: dex.available || gecko.available, pairs: validation.pairs, validation,
    name: identity ? (identity.side === "base" ? identity.baseName : identity.quoteName) ?? null : null, symbol: identity ? identity.side === "base" ? identity.baseSymbol : identity.quoteSymbol : null,
    imageUrl: null, websites: [], socials: [],
    ...(validation.price.value === null ? { error: validation.price.reason } : {}) };
}
