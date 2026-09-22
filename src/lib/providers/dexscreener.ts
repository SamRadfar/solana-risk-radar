/**
 * DexScreener public API — free, no API key required.
 * Docs: https://docs.dexscreener.com/api/reference
 *
 * This is the sole market-data provider today. It is isolated behind this
 * module (and the `MarketData` shape below) so it can be swapped for another
 * aggregator (GeckoTerminal, Birdeye, Jupiter) without touching the risk
 * engine: rules depend only on `MarketData`, never on DexScreener's wire
 * format.
 *
 * Raw pool rows never reach the rules directly: everything below the fetch is
 * derived from `marketConsensus`, which validates, weights and reconciles the
 * pools before any figure is taken from them.
 */

import { buildConsensus, type MarketConsensus } from "../market/consensus";


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
  /**
   * Listing metadata submitted by whoever created this pool. Per-pair on
   * purpose: it is the pool's claim about the token, not the token's own
   * record, so it must be attributable to a market the consensus accepted.
   */
  info: { imageUrl: string | null; websites: string[]; socials: string[] };
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
  chainId?: string;
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
    // The endpoint is address-keyed, not chain-keyed. Solana addresses cannot
    // collide with EVM ones in practice, but reading a pair from another chain
    // as if it were this mint's market is not a failure worth risking.
    const rawPairs = (Array.isArray(json.pairs) ? json.pairs : []).filter(
      (pair) => pair?.chainId === undefined || pair.chainId === "solana",
    );

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
        info: {
          // Only meaningful when this pair actually prices the analysed mint.
          imageUrl: mintIsBase ? (pair.info?.imageUrl ?? null) : null,
          websites: mintIsBase ? collectUrls(pair.info?.websites) : [],
          socials: mintIsBase ? collectUrls(pair.info?.socials) : [],
        },
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

/*
 * Every aggregate below is derived from the market *consensus*, not from raw
 * pool rows. The rules and the UI call these exactly as before; what changed
 * is that outliers, duplicates, dust pools and markets for other assets no
 * longer reach them.
 *
 * The consensus is memoised per payload: it is a pure function of the data,
 * several rules ask for it during one analysis, and recomputing it each time
 * would be wasted work — never stale, because a new fetch is a new object.
 */
const consensusCache = new WeakMap<MarketData, MarketConsensus>();

export function marketConsensus(market: MarketData): MarketConsensus {
  const cached = consensusCache.get(market);
  if (cached) return cached;
  const consensus = buildConsensus(market);
  consensusCache.set(market, consensus);
  return consensus;
}

/** Liquidity across the markets that survived validation. */
export function totalLiquidity(market: MarketData): number {
  return marketConsensus(market).liquidityUsd ?? 0;
}

/** 24h volume across the markets that survived validation. */
export function totalVolume24h(market: MarketData): number {
  return marketConsensus(market).volume24hUsd ?? 0;
}

/** Accepted pools, deepest first. Rejected markets never appear. */
export function pairsByLiquidity(market: MarketData): MarketPair[] {
  const accepted = new Set(
    marketConsensus(market)
      .observations.filter((o) => o.accepted)
      .map((o) => o.pairAddress),
  );
  return [...market.pairs]
    .filter((pair) => accepted.has(pair.pairAddress))
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd);
}

/**
 * The deepest pool inside the accepted consensus cluster.
 *
 * This is the pool the price history is read from, so it has to be one the
 * consensus vouches for — reading history from a rejected market is how a
 * chart ends somewhere the stated price is not.
 */
export function canonicalPair(market: MarketData): MarketPair | null {
  const pool = marketConsensus(market).canonicalPool;
  if (!pool) return null;
  return market.pairs.find((pair) => pair.pairAddress === pool.pairAddress) ?? null;
}

/**
 * Listing metadata from the deepest market the consensus accepted.
 *
 * Links and the logo are submitted per pool rather than published by the
 * token, so taking them from whichever pool happens to be deepest means an
 * outlier — the very market rejected as describing something else — can decide
 * which website the report points at. Reading them from an accepted market
 * ties them to the same evidence the price came from.
 */
export function marketIdentity(market: MarketData): {
  imageUrl: string | null;
  websites: string[];
  socials: string[];
} {
  const accepted = pairsByLiquidity(market);
  const withInfo =
    accepted.find(
      (pair) =>
        pair.info.imageUrl !== null ||
        pair.info.websites.length > 0 ||
        pair.info.socials.length > 0,
    ) ?? null;

  return withInfo
    ? withInfo.info
    : { imageUrl: null, websites: [], socials: [] };
}

/** The consensus price. Null when no market could be trusted. */
export function spotPrice(market: MarketData): number | null {
  return marketConsensus(market).priceUsd;
}

/** Weighted-median 24h change across accepted markets. */
export function priceChange24h(market: MarketData): number | null {
  return marketConsensus(market).priceChange24hPercent;
}

/**
 * Market capitalisation: the consensus price times the circulating supply the
 * accepted markets imply.
 *
 * Built from the canonical price rather than read from a pool, so the cap can
 * never describe a different price than the one on screen. Returns null when
 * no accepted market reports a capitalisation — a fully diluted figure is a
 * different measurement and is never substituted for this one.
 */
export function marketCap(market: MarketData, totalSupplyUi?: number): number | null {
  const consensus = marketConsensus(market);
  if (consensus.priceUsd === null || consensus.impliedCirculating === null) return null;

  /*
   * Circulating supply cannot exceed the supply that exists. When the mint's
   * own total is known, an implied circulating above it means the provider's
   * capitalisation describes a different token or a different unit — so the
   * figure is withheld rather than printed. The 2% allowance absorbs the gap
   * between the provider's snapshot and the current on-chain supply.
   */
  if (
    typeof totalSupplyUi === "number" &&
    Number.isFinite(totalSupplyUi) &&
    totalSupplyUi > 0 &&
    consensus.impliedCirculating > totalSupplyUi * 1.02
  ) {
    return null;
  }

  const cap = consensus.priceUsd * consensus.impliedCirculating;
  return Number.isFinite(cap) && cap > 0 ? cap : null;
}

/**
 * Fully diluted valuation: the consensus price times the mint's own total
 * supply, read on chain.
 *
 * Deliberately not the provider's `fdv` field — this way both valuations are
 * computed here, from the same price, against supplies whose provenance is
 * known.
 */
export function fullyDilutedValuation(
  market: MarketData,
  totalSupplyUi: number,
): number | null {
  const price = marketConsensus(market).priceUsd;
  if (price === null || !Number.isFinite(totalSupplyUi) || totalSupplyUi <= 0) return null;
  const fdv = price * totalSupplyUi;
  return Number.isFinite(fdv) && fdv > 0 ? fdv : null;
}
