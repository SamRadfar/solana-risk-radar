import { validateMintAddress } from "../solana/address";
import { TRUSTED_QUOTE_MINTS } from "../market/policy";
import type { PoolObservation, ProviderSnapshot, TokenReference } from "../market/types";
import { object, list, string, positive, nonnegative, finite, safeUrl, marketJson } from "./market-http";

export const GECKO_ENDPOINT = "https://api.geckoterminal.com/api/v2/networks/solana";
export function geckoAddress(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("solana_")) return null;
  const address = value.slice(7);
  return validateMintAddress(address).valid ? address : null;
}
export function normalizeGeckoToken(raw: unknown, fetchedAt: number, sourceUrl: string): TokenReference | null {
  const row = object(raw), a = object(row.attributes), mint = geckoAddress(row.id);
  const priceUsd = positive(a.price_usd);
  return mint && a.address === mint && priceUsd ? {
    provider: "geckoterminal", mint, priceUsd, marketCap: positive(a.market_cap_usd), fetchedAt, sourceUrl,
  } : null;
}
export function normalizeGeckoPools(body: unknown, mint: string, fetchedAt: number): PoolObservation[] {
  const root = object(body);
  const included = new Map(list(root.included).map(raw => { const r = object(raw); return [r.id, object(r.attributes)]; }));
  return list(root.data).map(raw => {
    const row = object(raw), a = object(row.attributes), rel = object(row.relationships);
    const baseId = object(object(rel.base_token).data).id, quoteId = object(object(rel.quote_token).data).id;
    const baseAddress = geckoAddress(baseId), quoteAddress = geckoAddress(quoteId);
    const pairAddress = geckoAddress(row.id), side = baseAddress === mint && quoteAddress !== mint ? "base" : quoteAddress === mint && baseAddress !== mint ? "quote" : null;
    const counterMint = side === "base" ? quoteAddress : side === "quote" ? baseAddress : null;
    const tx = object(object(a.transactions).h24), created = typeof a.pool_created_at === "string" ? Date.parse(a.pool_created_at) : NaN;
    return {
      provider: "geckoterminal", chain: "solana", dexId: string(object(object(rel.dex).data).id) ?? "unknown",
      pairAddress, requestedMint: mint, baseAddress, baseSymbol: string(included.get(baseId)?.symbol),
      quoteAddress, quoteSymbol: string(included.get(quoteId)?.symbol), side, counterMint,
      trustedCounterMint: counterMint !== null && TRUSTED_QUOTE_MINTS.has(counterMint),
      priceNative: positive(a.base_token_price_quote_token),
      requestedNativeRatio: side === "base" ? positive(a.base_token_price_quote_token) : side === "quote" ? positive(a.quote_token_price_base_token) : null,
      reportedPriceUsd: positive(a.base_token_price_usd),
      reportedCounterPriceUsd: side === "base" ? positive(a.quote_token_price_usd) : side === "quote" ? positive(a.base_token_price_usd) : null,
      priceUsd: side === "base" ? positive(a.base_token_price_usd) : side === "quote" ? positive(a.quote_token_price_usd) : null,
      liquidityUsd: nonnegative(a.reserve_in_usd), volume24hUsd: nonnegative(object(a.volume_usd).h24),
      reportedChange24h: finite(object(a.price_change_percentage).h24),
      priceChange24h: side === "base" ? finite(object(a.price_change_percentage).h24) : null,
      buys24h: nonnegative(side === "quote" ? tx.sells : tx.buys), sells24h: nonnegative(side === "quote" ? tx.buys : tx.sells),
      pairCreatedAt: Number.isFinite(created) ? created : null,
      marketCap: side === "base" ? positive(a.market_cap_usd) : null, fdv: side === "base" ? positive(a.fdv_usd) : null,
      fetchedAt, providerUpdatedAt: null, sourceUrl: GECKO_ENDPOINT + "/pools/" + (pairAddress ?? ""),
      identityError: !pairAddress || a.address !== pairAddress || !baseAddress || !quoteAddress || !side ? "Pool/token identity or orientation is unproven" : null,
      info: { imageUrl: safeUrl(included.get("solana_" + mint)?.image_url), websites: [], socials: [] },
    };
  });
}
export async function getGeckoSnapshot(mint: string): Promise<ProviderSnapshot> {
  const url = GECKO_ENDPOINT + "/tokens/" + encodeURIComponent(mint);
  const [tokenResult, poolsResult] = await Promise.all([marketJson(url), marketJson(url + "/pools?include=base_token,quote_token")]);
  const token = normalizeGeckoToken(object(tokenResult.body).data, tokenResult.fetchedAt, url);
  const observations = normalizeGeckoPools(poolsResult.body, mint, poolsResult.fetchedAt);
  const validToken = token?.mint === mint ? token : null;
  const errors = [...tokenResult.events, ...poolsResult.events, tokenResult.error, poolsResult.error].filter((x): x is string => x !== null);
  if (!validToken && !Array.isArray(object(poolsResult.body).data)) errors.push("No identified token or pool response");
  return { provider: "geckoterminal", mint, fetchedAt: Math.max(tokenResult.fetchedAt, poolsResult.fetchedAt),
    available: validToken !== null || Array.isArray(object(poolsResult.body).data), token: validToken, observations, errors };
}
/**
 * GeckoTerminal's view of specific pools, fetched by address because another
 * provider listed them. Used only to corroborate those pools, never as a price vote.
 */
export async function getGeckoPoolsByAddress(mint: string, addresses: string[]): Promise<{ observations: PoolObservation[]; error: string | null }> {
  if (!addresses.length) return { observations: [], error: null };
  const result = await marketJson(GECKO_ENDPOINT + "/pools/multi/" + addresses.map(encodeURIComponent).join(",") + "?include=base_token,quote_token");
  const observations = normalizeGeckoPools(result.body, mint, result.fetchedAt).filter(o => o.pairAddress !== null && addresses.includes(o.pairAddress));
  return { observations, error: result.error ?? (!Array.isArray(object(result.body).data) ? "Malformed pool lookup response" : result.events.join("; ") || null) };
}
/** Bounded batch; counter prices are contradiction checks, not extra provider votes. */
export async function getGeckoReferences(mints: string[]): Promise<{ references: TokenReference[]; error: string | null }> {
  if (!mints.length) return { references: [], error: null };
  const url = GECKO_ENDPOINT + "/tokens/multi/" + mints.map(encodeURIComponent).join(",");
  const result = await marketJson(url);
  return { error: result.error ?? (!Array.isArray(object(result.body).data) ? "Malformed counter-reference response" : result.events.join("; ") || null),
    references: list(object(result.body).data).map(raw => normalizeGeckoToken(raw, result.fetchedAt, url))
      .filter((r): r is TokenReference => r !== null && mints.includes(r.mint)) };
}
