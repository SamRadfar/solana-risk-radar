/** Version both diagnostics and cache keys whenever interpretation changes. */
export const MARKET_ALGORITHM_VERSION = "market-integrity-v2.5";

/**
 * Symmetric max/min - 1 distances, not a token-specific dollar target.
 * Five percent accommodates asynchronous venue snapshots while refusing large
 * valuation disagreements. Calibration and limitations: docs/MARKET_INTEGRITY.md.
 * These are data-validity tolerances, not risk-score thresholds.
 */
export const PRICE_AGREEMENT_TOLERANCE = 0.05;
export const POOL_CLUSTER_TOLERANCE = 0.10;
export const NATIVE_USD_TOLERANCE = 0.10;
export const CIRCULATION_AGREEMENT_TOLERANCE = 0.05;
/** Compare gross returns (1 + percent/100), never clamp extreme movement. */
export const CHANGE_AGREEMENT_TOLERANCE = 0.05;
export const DEPTH_AGREEMENT_TOLERANCE = 0.25;
export const ACTIVITY_AGREEMENT_TOLERANCE = 0.35;
export const MAX_SNAPSHOT_AGE_MS = 90_000;
export const MAX_HISTORY_AGE_MS = 15 * 60_000;
export const PROVIDER_TIMEOUT_MS = 8_000;
export const MIN_OBSERVATION_LIQUIDITY_USD = 250;
export const MAX_QUOTE_REFERENCES = 12;

/** An address registry is identity evidence, NOT a fixed USD peg assumption. */
export const TRUSTED_QUOTE_MINTS = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
]);

export function relativeDifference(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) return Infinity;
  if (a === b) return 0;
  return Math.min(a, b) === 0 ? Infinity : Math.max(a, b) / Math.min(a, b) - 1;
}

export function agrees(a: number, b: number, tolerance = PRICE_AGREEMENT_TOLERANCE): boolean {
  // Round-off must not reject a value exactly on the documented boundary.
  return relativeDifference(a, b) <= tolerance + Number.EPSILON * 8;
}

export const reportCacheKey = (mint: string) => MARKET_ALGORITHM_VERSION + ":report:" + mint;
export const historyCacheKey = (mint: string, pool: string) =>
  MARKET_ALGORITHM_VERSION + ":history:" + mint + ":" + pool;
