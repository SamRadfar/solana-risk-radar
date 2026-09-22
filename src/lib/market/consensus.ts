import type { MarketData, MarketPair } from "../providers/dexscreener";

/**
 * Market consensus: one defensible price for a mint, from many markets.
 *
 * The previous model trusted the deepest pool. That is indefensible, and it
 * failed in production: a Meteora pool quoted BONK at roughly 5,000x the real
 * price while reporting $36.5M of liquidity, so it won on depth and took the
 * whole report with it — price, market cap and 24h change all absurd.
 *
 * Depth is evidence, not authority. This module treats every pool as an
 * *observation* to be validated, weighted and then reconciled against the
 * others, so agreement between independent markets outranks the confidence of
 * any single one.
 *
 * The estimator is a **liquidity-weighted median with iterative outlier
 * rejection**:
 *
 *   1. discard pairs that cannot be trusted at all (wrong chain, mint not the
 *      base token, unusable price, duplicate pool, negligible depth);
 *   2. take a provisional weighted median of what remains;
 *   3. reject observations that diverge from it beyond a relative threshold;
 *   4. recompute the weighted median over the survivors.
 *
 * A median is used rather than a mean because a mean has a breakdown point of
 * zero — a single 5,000x observation drags it arbitrarily far. A weighted
 * median moves only when weight *crosses* it, so an outlier has to out-weigh
 * the entire rest of the market to matter.
 *
 * Weights are `sqrt(liquidity)` scaled by activity, quote quality and
 * freshness. The square root is deliberate: a pool a hundred times deeper
 * earns ten times the say, not a hundred times. That is what stops a single
 * large but wrong market dominating a crowd of smaller correct ones.
 */

/** Below this, a pool's quoted price is noise rather than a market. */
const MIN_LIQUIDITY_USD = 250;
/**
 * Relative distance from the provisional consensus beyond which an
 * observation is treated as describing a different asset or a broken market.
 * Real cross-venue spread on Solana is well under a percent; 30% is loose
 * enough never to reject an honest market and tight enough to catch the
 * failures that matter, which are multiplicative.
 */
const OUTLIER_TOLERANCE = 0.3;
/**
 * Outlier rejection needs a crowd to disagree with. With one or two markets
 * there is no consensus to deviate from, so nothing is rejected and the
 * confidence reflects that instead.
 */
const MIN_OBSERVATIONS_FOR_OUTLIER_REJECTION = 3;
/**
 * No single market may hold this share of the weight of all the others.
 *
 * Square-rooting depth slows a large pool's influence but does not bound it:
 * the BONK pool reported 121x the depth of any honest market, which even
 * square-rooted still out-weighed all nine of them combined — and a weighted
 * median only moves when weight crosses it, so it moved. Capping each
 * observation below the combined weight of the rest restores the property the
 * estimator is chosen for: one market, however deep, can never outvote a
 * market that disagrees with it.
 */
const MAX_SHARE_OF_OTHERS = 0.9;

/** Quote assets whose USD conversion is itself dependable. */
const STRONG_QUOTES = new Set(["USDC", "USDT", "SOL", "WSOL", "USDE", "PYUSD"]);

export type Confidence = "high" | "medium" | "low" | "none";

export interface MarketObservation {
  dexId: string;
  pairAddress: string | null;
  quoteSymbol: string | null;
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  buys24h: number;
  sells24h: number;
  priceChange24h: number | null;
  /** Circulating supply this market implies, from its own cap and price. */
  impliedCirculating: number | null;
  weight: number;
  accepted: boolean;
  /** Why this observation was discarded, when it was. */
  rejection?: string;
  /** Relative distance from the consensus price, once one exists. */
  deviation?: number;
}

export interface MarketConsensus {
  /** True when a canonical price could be established at all. */
  available: boolean;
  priceUsd: number | null;
  confidence: Confidence;
  /** Every pool the provider returned, with its verdict. */
  observations: MarketObservation[];
  consideredCount: number;
  acceptedCount: number;
  rejectedCount: number;
  /** Liquidity-weighted mean relative deviation across accepted markets. */
  dispersion: number | null;
  /** Accepted liquidity as a share of all liquidity that had a usable price. */
  liquidityShare: number | null;
  /** Summed across accepted markets only. */
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  buys24h: number;
  sells24h: number;
  priceChange24hPercent: number | null;
  /** Weighted-median circulating supply implied by accepted markets. */
  impliedCirculating: number | null;
  /** The deepest accepted market — the one safe to read history from. */
  canonicalPool: { pairAddress: string | null; dexId: string } | null;
  method: string;
}

const EMPTY = (observations: MarketObservation[] = []): MarketConsensus => ({
  available: false,
  priceUsd: null,
  confidence: "none",
  observations,
  consideredCount: observations.length,
  acceptedCount: 0,
  rejectedCount: observations.length,
  dispersion: null,
  liquidityShare: null,
  liquidityUsd: null,
  volume24hUsd: null,
  buys24h: 0,
  sells24h: 0,
  priceChange24hPercent: null,
  impliedCirculating: null,
  canonicalPool: null,
  method: "liquidity-weighted median with iterative outlier rejection",
});

/**
 * Weighted median: the value at which cumulative weight crosses half.
 *
 * Unlike a mean, its breakdown point is 50% of the weight — an outlier must
 * out-weigh everything else combined before it can move the answer at all.
 */
function weightedMedian(
  entries: { value: number; weight: number }[],
): number | null {
  const usable = entries.filter((e) => Number.isFinite(e.value) && e.weight > 0);
  if (usable.length === 0) return null;
  if (usable.length === 1) return usable[0].value;

  const sorted = [...usable].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, e) => sum + e.weight, 0);
  const half = total / 2;

  let running = 0;
  for (const entry of sorted) {
    running += entry.weight;
    if (running >= half) return entry.value;
  }
  return sorted[sorted.length - 1].value;
}

/**
 * How much say a market gets.
 *
 * Depth is the dominant term but is square-rooted, so influence grows far more
 * slowly than size — the point of the whole exercise is that being big is not
 * the same as being right.
 */
function weigh(pair: MarketPair): number {
  const depth = Math.sqrt(Math.max(pair.liquidityUsd, 0));

  // A market that has traded is better evidence than one that merely holds
  // inventory; the log keeps a whale's volume from swamping the term.
  const activity = 1 + Math.log10(1 + Math.max(pair.volume24hUsd, 0)) / 12;

  // A price quoted against an asset whose own USD value is well established
  // needs less conversion to trust.
  const quote = STRONG_QUOTES.has((pair.quoteSymbol ?? "").toUpperCase()) ? 1 : 0.75;

  // No trades at all in 24h means the quote is a standing offer, not a price.
  const fresh = pair.buys24h + pair.sells24h > 0 ? 1 : 0.4;

  return depth * activity * quote * fresh;
}

/**
 * Bounds any one observation's influence by the weight of the others.
 *
 * Applied only once there are enough markets to have a majority at all: with
 * one or two, there is no crowd to protect, and capping would only distort
 * the little evidence there is.
 */
function capDominantWeights(observations: MarketObservation[]): void {
  if (observations.length < MIN_OBSERVATIONS_FOR_OUTLIER_REJECTION) return;

  const total = observations.reduce((sum, o) => sum + o.weight, 0);
  for (const observation of observations) {
    const others = total - observation.weight;
    observation.weight = Math.min(observation.weight, others * MAX_SHARE_OF_OTHERS);
  }
}

function classifyConfidence(
  accepted: number,
  dispersion: number | null,
  liquidityShare: number | null,
  strongQuotes: number,
): Confidence {
  if (accepted === 0) return "none";

  const tight = dispersion !== null && dispersion <= 0.02;
  const loose = dispersion !== null && dispersion <= 0.08;
  const share = liquidityShare ?? 0;

  if (accepted >= 3 && tight && share >= 0.8 && strongQuotes >= 1) return "high";
  if (accepted >= 2 && loose && share >= 0.5) return "medium";
  return "low";
}

/**
 * Builds the consensus view of a mint's market.
 *
 * Every pool the provider returned appears in `observations`, accepted or not,
 * with the reason — an incorrect figure should always be traceable to the
 * market that produced it and the rule that let it through.
 */
export function buildConsensus(market: MarketData): MarketConsensus {
  if (!market.available || market.pairs.length === 0) return EMPTY();

  const observations: MarketObservation[] = [];
  const seen = new Map<string, MarketObservation>();

  for (const pair of market.pairs) {
    const observation: MarketObservation = {
      dexId: pair.dexId,
      pairAddress: pair.pairAddress,
      quoteSymbol: pair.quoteSymbol,
      priceUsd: pair.priceUsd ?? 0,
      liquidityUsd: pair.liquidityUsd,
      volume24hUsd: pair.volume24hUsd,
      buys24h: pair.buys24h,
      sells24h: pair.sells24h,
      priceChange24h: pair.priceChange24h,
      impliedCirculating:
        pair.marketCap !== null && pair.priceUsd !== null && pair.priceUsd > 0
          ? pair.marketCap / pair.priceUsd
          : null,
      weight: 0,
      accepted: false,
    };

    // The provider only fills `priceUsd` when the analysed mint is the pair's
    // base token, so a null here means this market prices something else.
    if (pair.priceUsd === null) {
      observation.rejection = "Mint is not the base token of this pair";
    } else if (!Number.isFinite(pair.priceUsd) || pair.priceUsd <= 0) {
      observation.rejection = "Reported price is not a usable number";
    } else if (!Number.isFinite(pair.liquidityUsd) || pair.liquidityUsd < 0) {
      observation.rejection = "Reported liquidity is not a usable number";
    } else if (pair.liquidityUsd < MIN_LIQUIDITY_USD) {
      observation.rejection = `Negligible liquidity (under $${MIN_LIQUIDITY_USD})`;
    } else if (pair.pairAddress !== null && seen.has(pair.pairAddress)) {
      observation.rejection = "Duplicate of a pool already counted";
    } else {
      observation.weight = weigh(pair);
      observation.accepted = true;
      if (pair.pairAddress !== null) seen.set(pair.pairAddress, observation);
    }

    observations.push(observation);
  }

  let candidates = observations.filter((o) => o.accepted);
  if (candidates.length === 0) return EMPTY(observations);

  capDominantWeights(candidates);

  // Liquidity that had a usable price at all — the denominator for "how much
  // of this market backs the answer".
  const pricedLiquidity = candidates.reduce((sum, o) => sum + o.liquidityUsd, 0);

  // Provisional consensus, then reject what disagrees with it.
  const provisional = weightedMedian(
    candidates.map((o) => ({ value: o.priceUsd, weight: o.weight })),
  );

  if (provisional !== null && provisional > 0) {
    for (const observation of candidates) {
      observation.deviation = Math.abs(observation.priceUsd - provisional) / provisional;
    }

    if (candidates.length >= MIN_OBSERVATIONS_FOR_OUTLIER_REJECTION) {
      for (const observation of candidates) {
        if ((observation.deviation ?? 0) > OUTLIER_TOLERANCE) {
          observation.accepted = false;
          const ratio = observation.priceUsd / provisional;
          observation.rejection =
            ratio > 1
              ? `Price is ${ratio.toFixed(ratio > 10 ? 0 : 2)}x the market consensus`
              : `Price is ${(1 / ratio).toFixed(ratio < 0.1 ? 0 : 2)}x below the market consensus`;
        }
      }
      candidates = candidates.filter((o) => o.accepted);
    }
  }

  if (candidates.length === 0) return EMPTY(observations);

  const priceUsd = weightedMedian(
    candidates.map((o) => ({ value: o.priceUsd, weight: o.weight })),
  );
  if (priceUsd === null || priceUsd <= 0) return EMPTY(observations);

  // Deviations are restated against the final answer.
  for (const observation of candidates) {
    observation.deviation = Math.abs(observation.priceUsd - priceUsd) / priceUsd;
  }

  const acceptedLiquidity = candidates.reduce((sum, o) => sum + o.liquidityUsd, 0);
  const totalWeight = candidates.reduce((sum, o) => sum + o.weight, 0);

  const dispersion =
    totalWeight > 0
      ? candidates.reduce((sum, o) => sum + o.weight * (o.deviation ?? 0), 0) / totalWeight
      : null;

  const changes = candidates.filter((o) => o.priceChange24h !== null);
  const impliedSupplies = candidates.filter((o) => o.impliedCirculating !== null);
  const deepest = [...candidates].sort((a, b) => b.liquidityUsd - a.liquidityUsd)[0];

  return {
    available: true,
    priceUsd,
    confidence: classifyConfidence(
      candidates.length,
      dispersion,
      pricedLiquidity > 0 ? acceptedLiquidity / pricedLiquidity : null,
      candidates.filter((o) => STRONG_QUOTES.has((o.quoteSymbol ?? "").toUpperCase()))
        .length,
    ),
    observations,
    consideredCount: observations.length,
    acceptedCount: candidates.length,
    rejectedCount: observations.length - candidates.length,
    dispersion,
    liquidityShare: pricedLiquidity > 0 ? acceptedLiquidity / pricedLiquidity : null,
    liquidityUsd: acceptedLiquidity,
    volume24hUsd: candidates.reduce((sum, o) => sum + o.volume24hUsd, 0),
    buys24h: candidates.reduce((sum, o) => sum + o.buys24h, 0),
    sells24h: candidates.reduce((sum, o) => sum + o.sells24h, 0),
    priceChange24hPercent:
      changes.length > 0
        ? weightedMedian(
            changes.map((o) => ({ value: o.priceChange24h as number, weight: o.weight })),
          )
        : null,
    impliedCirculating:
      impliedSupplies.length > 0
        ? weightedMedian(
            impliedSupplies.map((o) => ({
              value: o.impliedCirculating as number,
              weight: o.weight,
            })),
          )
        : null,
    canonicalPool: deepest
      ? { pairAddress: deepest.pairAddress, dexId: deepest.dexId }
      : null,
    method: "liquidity-weighted median with iterative outlier rejection",
  };
}
