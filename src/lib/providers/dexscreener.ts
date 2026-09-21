/**
 * DexScreener public API — free, no API key required.
 * Docs: https://docs.dexscreener.com/api/reference
 *
 * This is the sole market-data provider today. It is isolated behind this
 * module (and the `MarketData` shape below) so it can be swapped for another
 * aggregator (GeckoTerminal, Birdeye, Jupiter) without touching the risk
 * engine: rules depend only on `MarketData`, never on DexScreener's wire
 * format.
 */

export interface MarketPair {
  dexId: string;
  pairAddress: string | null;
  /** Ticker of the other side of the pair, e.g. "SOL" or "USDC". */
  quoteSymbol: string | null;
  liquidityUsd: number;
  volume24hUsd: number;
  priceUsd: number | null;
  /** ms epoch */
  pairCreatedAt: number | null;
  fdv: number | null;
  marketCap: number | null;
  priceChange24h: number | null;
  buys24h: number;
  sells24h: number;
  url: string | null;
}

export interface MarketData {
  available: boolean;
  pairs: MarketPair[];
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  websites: string[];
  socials: string[];
  error?: string;
}

interface DexScreenerToken {
  address?: string;
  name?: string;
  symbol?: string;
}

interface DexScreenerPair {
  dexId?: string;
  pairAddress?: string;
  url?: string;
  baseToken?: DexScreenerToken;
  quoteToken?: DexScreenerToken;
  priceUsd?: string;
  priceChange?: { h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  pairCreatedAt?: number;
  fdv?: number;
  marketCap?: number;
  info?: {
    imageUrl?: string;
    websites?: { url?: string }[];
    socials?: { url?: string }[];
  };
}

interface DexScreenerResponse {
  pairs: DexScreenerPair[] | null;
}

const ENDPOINT = "https://api.dexscreener.com/latest/dex/tokens";
const TIMEOUT_MS = 10_000;

const EMPTY = (
  overrides: Partial<MarketData> & Pick<MarketData, "available">,
): MarketData => ({
  pairs: [],
  name: null,
  symbol: null,
  imageUrl: null,
  websites: [],
  socials: [],
  ...overrides,
});

/** Coerce an untrusted numeric field into a finite number, or null. */
function num(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

export async function getMarketData(mintAddress: string): Promise<MarketData> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${ENDPOINT}/${encodeURIComponent(mintAddress)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      return EMPTY({
        available: false,
        error: `DexScreener returned HTTP ${response.status}.`,
      });
    }

    const json = (await response.json()) as DexScreenerResponse;
    const rawPairs = Array.isArray(json.pairs) ? json.pairs : [];

    // "No pools" is a successful answer, and a meaningful risk signal itself.
    if (rawPairs.length === 0) return EMPTY({ available: true });

    /**
     * DexScreener's `baseToken`, `priceUsd`, `fdv` and `marketCap` all describe
     * the BASE token of each pair. The queried mint can appear on either side,
     * so those fields are only trusted for pairs where it is actually the base
     * token — otherwise a token gets silently labelled with its counterparty's
     * name (querying USDC once returned a pair labelled "Pump").
     *
     * Pair-wide fields (liquidity, volume, pool age) are valid either way.
     */
    const isMintBase = (pair: DexScreenerPair) =>
      pair.baseToken?.address === mintAddress;

    const pairs: MarketPair[] = rawPairs.map((pair) => {
      const mintIsBase = isMintBase(pair);
      return {
        dexId: pair.dexId ?? "unknown",
        pairAddress: pair.pairAddress ?? null,
        quoteSymbol:
          (mintIsBase ? pair.quoteToken?.symbol : pair.baseToken?.symbol) ?? null,
        liquidityUsd: num(pair.liquidity?.usd) ?? 0,
        volume24hUsd: num(pair.volume?.h24) ?? 0,
        priceUsd: mintIsBase ? num(pair.priceUsd) : null,
        pairCreatedAt: num(pair.pairCreatedAt),
        fdv: mintIsBase ? num(pair.fdv) : null,
        marketCap: mintIsBase ? num(pair.marketCap) : null,
        priceChange24h: mintIsBase ? num(pair.priceChange?.h24) : null,
        buys24h: num(pair.txns?.h24?.buys) ?? 0,
        sells24h: num(pair.txns?.h24?.sells) ?? 0,
        url: pair.url ?? null,
      };
    });

    // Identity comes from the deepest pool in which the mint is the base token.
    const identityPair = rawPairs
      .filter(isMintBase)
      .sort((a, b) => (num(b.liquidity?.usd) ?? 0) - (num(a.liquidity?.usd) ?? 0))[0];

    return {
      available: true,
      pairs,
      name: identityPair?.baseToken?.name ?? null,
      symbol: identityPair?.baseToken?.symbol ?? null,
      imageUrl: identityPair?.info?.imageUrl ?? null,
      websites: collectUrls(identityPair?.info?.websites),
      socials: collectUrls(identityPair?.info?.socials),
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return EMPTY({
      available: false,
      error: aborted
        ? `DexScreener did not respond within ${TIMEOUT_MS / 1000}s.`
        : error instanceof Error
          ? error.message
          : "Unknown error contacting DexScreener.",
    });
  } finally {
    clearTimeout(timer);
  }
}

/** External API content is untrusted: keep only well-formed http(s) URLs. */
function collectUrls(entries: { url?: string }[] | undefined): string[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => entry?.url)
    .filter((url): url is string => typeof url === "string")
    .filter((url) => {
      try {
        const { protocol } = new URL(url);
        return protocol === "https:" || protocol === "http:";
      } catch {
        return false;
      }
    })
    .slice(0, 8);
}

// ---------------------------------------------------------------------------
// Aggregates shared by several rules, so each computes them the same way.
// ---------------------------------------------------------------------------

export function totalLiquidity(market: MarketData): number {
  return market.pairs.reduce((sum, pair) => sum + pair.liquidityUsd, 0);
}

export function totalVolume24h(market: MarketData): number {
  return market.pairs.reduce((sum, pair) => sum + pair.volume24hUsd, 0);
}

/** Deepest pool first. */
export function pairsByLiquidity(market: MarketData): MarketPair[] {
  return [...market.pairs].sort((a, b) => b.liquidityUsd - a.liquidityUsd);
}

/** Best available market capitalisation, preferring circulating over fully diluted. */
export function marketCap(market: MarketData): number | null {
  for (const pair of pairsByLiquidity(market)) {
    if (pair.marketCap !== null && pair.marketCap > 0) return pair.marketCap;
    if (pair.fdv !== null && pair.fdv > 0) return pair.fdv;
  }
  return null;
}

/** Spot price from the deepest pool that reports one. */
export function spotPrice(market: MarketData): number | null {
  return pairsByLiquidity(market).find((pair) => pair.priceUsd !== null)?.priceUsd ?? null;
}

/**
 * 24h price change from the deepest pool that reports one.
 *
 * Deliberately the same selection rule as `spotPrice`, so the change shown
 * beside a price is the change belonging to that price rather than to some
 * other pool.
 */
export function priceChange24h(market: MarketData): number | null {
  return (
    pairsByLiquidity(market).find((pair) => pair.priceChange24h !== null)?.priceChange24h ??
    null
  );
}

/**
 * Fully diluted valuation from the same pool `marketCap` took its figure from.
 *
 * Locking onto that pool matters: searching independently for the deepest pool
 * that happens to report an FDV can land on a different pool and produce a
 * pair of figures that contradict each other — USDC reported a $60.9B market
 * cap beside a $9.3B "fully diluted" valuation, which is impossible. Reading
 * both from one pool means the two are always talking about the same market.
 *
 * Returns null when that pool reports no FDV, rather than borrowing one from
 * somewhere else.
 */
export function fullyDilutedValuation(market: MarketData): number | null {
  for (const pair of pairsByLiquidity(market)) {
    const hasMarketCap = pair.marketCap !== null && pair.marketCap > 0;
    const hasFdv = pair.fdv !== null && pair.fdv > 0;
    // The first pool with either figure is the one `marketCap` selects.
    if (hasMarketCap || hasFdv) return hasFdv ? pair.fdv : null;
  }
  return null;
}
