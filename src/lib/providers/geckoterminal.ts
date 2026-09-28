import { validateMintAddress } from "../solana/address";
import type { PriceHistory, PricePoint } from "../market/types";
import { object, list, positive, marketJson } from "./market-http";
export type { PriceHistory, PricePoint } from "../market/types";
export const HISTORY_WINDOW_MS = 4 * 60 * 60 * 1000;
const ENDPOINT = "https://api.geckoterminal.com/api/v2/networks/solana/pools";

/** Endpoint is explicitly requested in USD for this mint, including quote-side mints. */
export function normalizeHistory(body: unknown, mint: string, pool: string, now: number, sourceUrl: string, windowMs = HISTORY_WINDOW_MS, minPoints = 6): PriceHistory {
  const root = object(body), meta = object(root.meta);
  const base = object(meta.base).address, quote = object(meta.quote).address;
  const side = base === mint && quote !== mint ? "base" : quote === mint && base !== mint ? "quote" : null;
  const empty: PriceHistory = { available: false, points: [], pool, mint, side, fetchedAt: now, sourceUrl };
  if (!side || typeof base !== "string" || typeof quote !== "string" || !validateMintAddress(base).valid || !validateMintAddress(quote).valid) return { ...empty, error: "History token identity or orientation unproven" };
  const raw = object(object(root.data).attributes).ohlcv_list;
  if (!Array.isArray(raw)) return { ...empty, error: "Malformed history" };
  const points: PricePoint[] = [];
  const seen = new Map<number, number>();
  for (const item of list(raw)) {
    const row = list(item), seconds = positive(row[0]), p = positive(row[4]);
    if (seconds === null || p === null) continue;
    const t = seconds * 1000;
    if (t < now - windowMs || t > now + 60_000) continue;
    if (seen.has(t) && seen.get(t) !== p) return { ...empty, error: "Conflicting duplicate candles" };
    seen.set(t, p);
  }
  for (const [t,p] of seen) points.push({ t,p });
  points.sort((a,b) => a.t-b.t);
  return { ...empty, points, available: points.length >= minPoints,
    ...(points.length < minPoints ? { error: windowMs === HISTORY_WINDOW_MS ? "Fewer than six identified closes in the four-hour window" : `Fewer than ${minPoints} identified hourly closes in the window` } : {}) };
}
export async function getPriceHistory(mint: string, pool: string, now?: number): Promise<PriceHistory> {
  // GeckoTerminal supports a token ADDRESS as this parameter. Never invert
  // base USD candles: doing so yields USD^-1, not the quote token's USD price.
  const url = ENDPOINT + "/" + encodeURIComponent(pool) + "/ohlcv/minute?aggregate=5&limit=60&currency=usd&token=" + encodeURIComponent(mint);
  // Chart context is optional: it never spends a rate-limited provider's budget.
  const result = await marketJson(url, { optional: true });
  const history = normalizeHistory(result.body, mint, pool, now ?? result.fetchedAt, url);
  return { ...history, events: result.events, ...(result.error ? { error: result.error } : {}) };
}

/** About 30 hourly candles: enough to reach the close ~24 h before now. */
export const DAY_HISTORY_WINDOW_MS = 30 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
/**
 * Requested-mint USD hourly history for the 24 h movement fallback (scored
 * evidence, so not optional). Same identity/orientation checks as the chart;
 * the USD series is requested for the MINT, never inverted from another token.
 */
export async function getDayPriceHistory(mint: string, pool: string, now?: number): Promise<PriceHistory> {
  const url = ENDPOINT + "/" + encodeURIComponent(pool) + "/ohlcv/hour?aggregate=1&limit=30&currency=usd&token=" + encodeURIComponent(mint);
  const result = await marketJson(url);
  const history = normalizeHistory(result.body, mint, pool, now ?? result.fetchedAt, url, DAY_HISTORY_WINDOW_MS, 2);
  return { ...history, events: result.events, ...(result.error ? { error: result.error } : {}) };
}
