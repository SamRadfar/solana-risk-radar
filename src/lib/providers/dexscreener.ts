/**
 * DexScreener public API — free, no API key required.
 * Docs: https://docs.dexscreener.com/api/reference
 *
 * This is the sole market-data provider today. It is isolated behind this
 * module (and the MarketData shape below) so it can be swapped for another
 * aggregator (e.g. Birdeye, GeckoTerminal) without touching the risk engine.
 */

export interface MarketPair {
  dexId: string;
  liquidityUsd: number;
  volume24hUsd: number;
  priceUsd: number | null;
  pairCreatedAt: number | null; // ms epoch
  fdv: number | null;
}

export interface MarketData {
  available: boolean;
  pairs: MarketPair[];
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  error?: string;
}

interface DexScreenerToken {
  address?: string;
  name?: string;
  symbol?: string;
}

interface DexScreenerPair {
  dexId: string;
  baseToken: DexScreenerToken;
  quoteToken: DexScreenerToken;
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  pairCreatedAt?: number;
  fdv?: number;
  info?: { imageUrl?: string };
}

interface DexScreenerResponse {
  pairs: DexScreenerPair[] | null;
}

export async function getMarketData(mintAddress: string): Promise<MarketData> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { available: false, pairs: [], name: null, symbol: null, imageUrl: null, error: `DexScreener HTTP ${res.status}` };
    }

    const json = (await res.json()) as DexScreenerResponse;
    if (!json.pairs || json.pairs.length === 0) {
      return { available: true, pairs: [], name: null, symbol: null, imageUrl: null };
    }

    // DexScreener's priceUsd/baseToken fields describe the BASE token of each
    // pair. Our mint can appear on either side, so only trust those fields
    // for pairs where our mint is actually the base token — otherwise
    // liquidity/volume still apply (pair-wide) but the price would be wrong.
    const isMintBase = (p: DexScreenerPair) => p.baseToken?.address === mintAddress;

    const pairs: MarketPair[] = json.pairs
      .filter((p) => p.dexId)
      .map((p) => ({
        dexId: p.dexId,
        liquidityUsd: p.liquidity?.usd ?? 0,
        volume24hUsd: p.volume?.h24 ?? 0,
        priceUsd: isMintBase(p) && p.priceUsd ? Number(p.priceUsd) : null,
        pairCreatedAt: p.pairCreatedAt ?? null,
        fdv: isMintBase(p) ? (p.fdv ?? null) : null,
      }));

    const richest = [...json.pairs]
      .filter(isMintBase)
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];

    return {
      available: true,
      pairs,
      name: richest?.baseToken?.name ?? null,
      symbol: richest?.baseToken?.symbol ?? null,
      imageUrl: richest?.info?.imageUrl ?? null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { available: false, pairs: [], name: null, symbol: null, imageUrl: null, error: message };
  }
}
