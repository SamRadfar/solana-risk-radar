import { validateMintAddress } from "../solana/address";
import { TRUSTED_QUOTE_MINTS } from "../market/policy";
import type { PoolObservation, ProviderSnapshot } from "../market/types";
import { object, list, string, positive, nonnegative, finite, safeUrl, marketJson } from "./market-http";
export type { MarketData, MarketPair } from "../market/types";

export const DEXSCREENER_ENDPOINT = "https://api.dexscreener.com/latest/dex/tokens";
const address = (v: unknown) => typeof v === "string" && validateMintAddress(v).valid ? v : null;
const urls = (v: unknown) => list(v).map(x => safeUrl(object(x).url)).filter((x): x is string => x !== null).slice(0, 8);

/** priceUsd describes BASE; a quote request needs the proven base/quote ratio. */
export function normalizeDexScreener(body: unknown, mint: string, fetchedAt: number): ProviderSnapshot {
  const root = object(body);
  const observations: PoolObservation[] = list(root.pairs).map(raw => {
    const p = object(raw), base = object(p.baseToken), quote = object(p.quoteToken);
    const baseAddress = address(base.address), quoteAddress = address(quote.address);
    const side = baseAddress === mint && quoteAddress !== mint ? "base" : quoteAddress === mint && baseAddress !== mint ? "quote" : null;
    const counterMint = side === "base" ? quoteAddress : side === "quote" ? baseAddress : null;
    const priceNative = positive(p.priceNative), reportedPriceUsd = positive(p.priceUsd);
    const tx = object(object(p.txns).h24), info = object(p.info), pairAddress = address(p.pairAddress);
    return {
      provider: "dexscreener", chain: string(p.chainId), dexId: string(p.dexId) ?? "unknown",
      pairAddress, requestedMint: mint, baseAddress, baseSymbol: string(base.symbol), baseName: string(base.name),
      quoteAddress, quoteSymbol: string(quote.symbol), quoteName: string(quote.name), side, counterMint,
      trustedCounterMint: counterMint !== null && TRUSTED_QUOTE_MINTS.has(counterMint),
      priceNative, requestedNativeRatio: side === "base" ? priceNative : side === "quote" && priceNative ? 1 / priceNative : null,
      reportedPriceUsd,
      priceUsd: side === "base" ? reportedPriceUsd : side === "quote" && priceNative && reportedPriceUsd ? positive(reportedPriceUsd / priceNative) : null,
      liquidityUsd: nonnegative(object(p.liquidity).usd), volume24hUsd: nonnegative(object(p.volume).h24),
      reportedChange24h: finite(object(p.priceChange).h24),
      priceChange24h: side === "base" ? finite(object(p.priceChange).h24) : null,
      buys24h: nonnegative(side === "quote" ? tx.sells : tx.buys),
      sells24h: nonnegative(side === "quote" ? tx.buys : tx.sells),
      pairCreatedAt: positive(p.pairCreatedAt),
      marketCap: side === "base" ? positive(p.marketCap) : null,
      fdv: side === "base" ? positive(p.fdv) : null, fetchedAt, providerUpdatedAt: null,
      sourceUrl: DEXSCREENER_ENDPOINT + "/" + encodeURIComponent(mint),
      identityError: p.chainId !== "solana" ? "Chain is not proven Solana" : !pairAddress || !baseAddress || !quoteAddress || !side ? "Pool/token identity or orientation is unproven" : null,
      info: { imageUrl: side === "base" ? safeUrl(info.imageUrl) : null, websites: side === "base" ? urls(info.websites) : [], socials: side === "base" ? urls(info.socials) : [] },
    };
  });
  const available = Array.isArray(root.pairs) || root.pairs === null;
  return { provider: "dexscreener", mint, available, fetchedAt, observations, token: null, errors: available ? [] : ["Malformed DexScreener response"] };
}
export async function getDexScreenerSnapshot(mint: string): Promise<ProviderSnapshot> {
  const result = await marketJson(DEXSCREENER_ENDPOINT + "/" + encodeURIComponent(mint));
  const snapshot = normalizeDexScreener(result.body, mint, result.fetchedAt);
  return result.error ? { ...snapshot, available: false, errors: [result.error] } : snapshot;
}
