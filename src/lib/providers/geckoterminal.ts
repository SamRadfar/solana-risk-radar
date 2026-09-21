/**
 * Short-range price history, from GeckoTerminal's public OHLCV endpoint.
 *
 * The existing market provider answers "what is this worth now" — it returns
 * current price, liquidity and 24h aggregates, and has no series behind it.
 * Nothing else in the pipeline stores observations over time either, so the
 * 4-hour chart needs its own source.
 *
 * GeckoTerminal was chosen because it is keyless and free, it indexes Solana
 * DEX pools rather than a curated token list (so a token listed nowhere else
 * still has history), and it is addressed *by pool* — which means it consumes
 * exactly the pool the rest of this product already treats as canonical
 * instead of introducing a second opinion about which market counts.
 *
 * Every response is untrusted. The pool is asked to identify its own base
 * token and the series is rejected outright if that is not the mint being
 * analysed; individual candles are rejected if they are not finite, positive
 * and inside the requested window. This series never reaches the risk engine —
 * it is context shown beside the verdict, never an input to it.
 */

const ENDPOINT = "https://api.geckoterminal.com/api/v2/networks/solana/pools";
const TIMEOUT_MS = 8_000;

/** Five-minute candles over four hours: 48 slots, before gaps. */
export const HISTORY_WINDOW_MS = 4 * 60 * 60 * 1000;
const CANDLE_MINUTES = 5;
/** Asked for generously; the window filter is what actually bounds the range. */
const REQUEST_LIMIT = 60;
/**
 * Below this many observations the shape of a line says more than the data
 * does, so nothing is drawn.
 */
const MIN_POINTS = 6;

export interface PricePoint {
  /** ms epoch */
  t: number;
  /** Close, in USD. */
  p: number;
}

export interface PriceHistory {
  available: boolean;
  points: PricePoint[];
  /** Which pool the series came from, so the reading stays traceable. */
  pool: string | null;
  /** Why there is nothing to draw, when there is nothing to draw. */
  error?: string;
}

const EMPTY = (pool: string | null, error: string): PriceHistory => ({
  available: false,
  points: [],
  pool,
  error,
});

function finitePositive(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0
    ? parsed
    : null;
}

/**
 * Fetches the last four hours of 5-minute closes for `mint`, as traded in
 * `pool`.
 *
 * `pool` is the caller's claim about which market to read; it is never
 * trusted. The response has to name `mint` as the pool's base token, or the
 * series is discarded — that is what stops a wrong or hostile pool address
 * producing a plausible-looking chart for the wrong asset.
 */
export async function getPriceHistory(
  mint: string,
  pool: string,
  now = Date.now(),
): Promise<PriceHistory> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const url =
      `${ENDPOINT}/${encodeURIComponent(pool)}/ohlcv/minute` +
      `?aggregate=${CANDLE_MINUTES}&limit=${REQUEST_LIMIT}&currency=usd&token=base`;

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      return EMPTY(
        pool,
        response.status === 404
          ? "No indexed price history for this pool."
          : `Price history service returned ${response.status}.`,
      );
    }

    const body: unknown = await response.json();
    const root = body as {
      data?: { attributes?: { ohlcv_list?: unknown } };
      meta?: { base?: { address?: unknown } };
    };

    // The pool must say it is this token's market before anything is drawn.
    const base = root.meta?.base?.address;
    if (typeof base !== "string" || base !== mint) {
      return EMPTY(pool, "The pool's base token does not match this mint.");
    }

    const raw = root.data?.attributes?.ohlcv_list;
    if (!Array.isArray(raw)) {
      return EMPTY(pool, "Price history was not in the expected shape.");
    }

    const cutoff = now - HISTORY_WINDOW_MS;
    const points: PricePoint[] = [];

    for (const candle of raw) {
      if (!Array.isArray(candle) || candle.length < 5) continue;
      const seconds = finitePositive(candle[0]);
      const close = finitePositive(candle[4]);
      if (seconds === null || close === null) continue;

      const t = seconds * 1000;
      // Ignore anything outside the window, and anything dated in the future —
      // a clock ahead of ours is a reason to distrust the row, not to plot it.
      if (t < cutoff || t > now + 60_000) continue;
      points.push({ t, p: close });
    }

    points.sort((a, b) => a.t - b.t);

    if (points.length < MIN_POINTS) {
      return EMPTY(
        pool,
        points.length === 0
          ? "No trades recorded in this pool over the last four hours."
          : `Only ${points.length} observations in the last four hours — too few to chart.`,
      );
    }

    return { available: true, points, pool };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return EMPTY(
      pool,
      aborted
        ? `Price history did not arrive within ${TIMEOUT_MS / 1000}s.`
        : error instanceof Error
          ? error.message
          : "Unknown error retrieving price history.",
    );
  } finally {
    clearTimeout(timer);
  }
}
