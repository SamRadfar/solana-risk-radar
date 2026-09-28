import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
import captured from "./fixtures/jup-2026-09-27.json";
import { normalizeDexScreener } from "../providers/dexscreener";
import { normalizeGeckoToken } from "../providers/gecko-market";
import { marketJson, clearRetainedResponses } from "../providers/market-http";
import { validateMarket, withHistory } from "./validation";
import { QUARANTINE_REASON } from "./consensus";
import { MARKET_ALGORITHM_VERSION, MAX_SNAPSHOT_AGE_MS, reportCacheKey } from "./policy";
import { liquidityDepthRule, poolDiversityRule } from "../risk-engine/rules/liquidity";
import { tradingActivityRule, tradeImbalanceRule } from "../risk-engine/rules/market";
import { poolMaturityRule } from "../risk-engine/rules/maturity";
import { makeInput, cleanRugCheck } from "../risk-engine/test-fixtures";
import { buildRiskReport } from "../risk-engine/engine";
import type { MarketData, MarketValidation, PoolObservation, ProviderSnapshot } from "./types";

const NOW = Date.parse(captured.capturedAt);
const MINT = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
function row(overrides: Partial<PoolObservation> = {}): PoolObservation {
  return { provider: "a", chain: "solana", dexId: "dex", pairAddress: "good-1", requestedMint: MINT,
    baseAddress: MINT, baseSymbol: "TKN", quoteAddress: USDC, quoteSymbol: "USDC", side: "base", counterMint: USDC,
    trustedCounterMint: true, priceNative: 0.03, requestedNativeRatio: 0.03, reportedPriceUsd: 0.03, priceUsd: 0.03,
    liquidityUsd: 100000, volume24hUsd: 10000, reportedChange24h: 2, priceChange24h: 2, buys24h: 100, sells24h: 100,
    pairCreatedAt: NOW - 400 * 86400000, marketCap: 30000, fdv: 60000, fetchedAt: NOW, providerUpdatedAt: null,
    sourceUrl: "https://fixture.invalid", identityError: null, info: { imageUrl: null, websites: [], socials: [] }, ...overrides };
}
const snap = (provider: string, observations: PoolObservation[], overrides: Partial<ProviderSnapshot> = {}): ProviderSnapshot =>
  ({ provider, mint: MINT, available: true, fetchedAt: NOW, observations: observations.map(o => ({ ...o, provider })), token: null, errors: [], ...overrides });
const good = (n: number, prefix = "good") => Array.from({ length: n }, (_, i) => row({ pairAddress: `${prefix}-${i}`, priceUsd: 0.03 + i * 0.0001 }));
const absurd = (pairAddress: string, priceUsd = 1638) => row({ pairAddress, priceUsd, liquidityUsd: 5e9, marketCap: 5e12 });
const validate = (a: ProviderSnapshot, b: ProviderSnapshot) => validateMarket(MINT, [a, b], [], NOW, 2e6);
const market = (v: MarketValidation): MarketData => ({ available: true, pairs: v.pairs, validation: v, name: null, symbol: null, imageUrl: null, websites: [], socials: [] });
function scored(v: MarketValidation) {
  const input = makeInput(); input.marketData = market(v);
  return [liquidityDepthRule, poolDiversityRule, tradingActivityRule, tradeImbalanceRule, poolMaturityRule].map(rule => rule(input));
}

describe("cross-provider corroborated price clusters", () => {
  it("a good cross-provider cluster plus one isolated absurd outlier: the good cluster validates, the outlier is quarantined", () => {
    const v = validate(snap("dexscreener", [...good(18), absurd("bad-1")]), snap("geckoterminal", good(6)));
    expect(v.price.status).toBe("validated");
    expect(v.price.value!).toBeGreaterThan(0.029); expect(v.price.value!).toBeLessThan(0.032);
    expect(v.priceClusters).toMatchObject({ status: "single-market", quarantined: [{ provider: "dexscreener", pools: ["bad-1"] }] });
    const bad = v.providers.find(p => p.provider === "dexscreener")!.observations.find(o => o.pairAddress === "bad-1")!;
    expect(bad).toMatchObject({ accepted: false, rejection: QUARANTINE_REASON });
    expect(v.providers.every(p => p.candidatePrices.every(c => c < 1))).toBe(true);
  });

  it("the isolated bad cluster no longer destroys unrelated valid market signals", () => {
    const v = validate(snap("dexscreener", [...good(3), absurd("bad-1")]), snap("geckoterminal", good(3)));
    expect(scored(v).every(s => s.status === "ok")).toBe(true);
    expect(v.liquidity.value).toBe(300000); // the $5B outlier pool is never counted
    expect(v.pairs.map(p => p.pairAddress)).not.toContain("bad-1");
  });

  it("two incompatible clusters independently corroborated by both providers keep price blocked", () => {
    const v = validate(snap("dexscreener", [...good(5), absurd("bad-1")]), snap("geckoterminal", [...good(5), absurd("bad-2")]));
    expect(v.priceClusters!.status).toBe("corroborated-conflict");
    expect(v.price).toMatchObject({ status: "conflict", value: null, reason: "Incompatible price clusters are each independently corroborated by more than one provider" });
    expect(scored(v).every(s => s.status === "unavailable")).toBe(true);
  });

  it("row count alone cannot choose a winner: corroboration decides, even against many more rows", () => {
    // Ten absurd rows on one provider, one good row corroborated by the other provider.
    const tenBad = Array.from({ length: 10 }, (_, i) => absurd("bad-" + i));
    const v = validate(snap("dexscreener", [row({ pairAddress: "good-0" }), ...tenBad]), snap("geckoterminal", [row({ pairAddress: "good-0" })]));
    expect(v.price.value).toBe(0.03);
    // The same ten rows corroborated by nobody but still outnumbering: without corroboration nothing is chosen.
    const alone = validate(snap("dexscreener", [row(), ...tenBad]), snap("geckoterminal", [row({ pairAddress: "x", priceUsd: 7 })]));
    expect(alone.price.value).toBeNull();
  });

  it("one provider alone cannot establish a canonical price, with or without an outlier", () => {
    expect(validateMarket(MINT, [snap("dexscreener", good(5))], [], NOW, 2e6).price).toMatchObject({ status: "single_source", value: null });
    const mixed = validateMarket(MINT, [snap("dexscreener", [...good(5), absurd("bad-1")])], [], NOW, 2e6);
    expect(mixed.price.value).toBeNull();
    expect(mixed.priceClusters!.status).toBe("not-applicable");
  });

  it("never averages between incompatible clusters", () => {
    const v = validate(snap("dexscreener", [row(), absurd("bad-1")]), snap("geckoterminal", [row()]));
    expect(v.price.value).toBe(0.03);
    expect(v.price.sources.map(s => s.value)).toEqual([0.03, 0.03]);
  });

  it("a token endpoint never corroborates a cluster, and an outlying token price is quarantined", () => {
    const tokenAt = (priceUsd: number) => ({ provider: "geckoterminal", mint: MINT, priceUsd, marketCap: null, fetchedAt: NOW, sourceUrl: "https://fixture.invalid" });
    const onlyToken = validate(snap("dexscreener", [row(), absurd("bad-1")]), snap("geckoterminal", [], { token: tokenAt(1638) }));
    expect(onlyToken.price.value).toBeNull();
    const withPools = validate(snap("dexscreener", good(3)), snap("geckoterminal", good(3), { token: tokenAt(1638) }));
    expect(withPools.priceClusters!.quarantinedTokens).toEqual(["geckoterminal"]);
    expect(withPools.price.value!).toBeLessThan(1);
  });
});

describe("historical JUP ~$1,638 corruption", () => {
  const dex = () => normalizeDexScreener(captured.dex, captured.mint, NOW);
  it("never enters the canonical price: blocked when GeckoTerminal offers no pools", () => {
    const token = normalizeGeckoToken(captured.gecko.data, NOW, "https://fixture.invalid");
    const v = validateMarket(captured.mint, [dex(), { provider: "geckoterminal", mint: captured.mint, available: true, fetchedAt: NOW, observations: [], token, errors: [] }], [], NOW, 6861486518.571356);
    expect(v.price.value).toBeNull();
    expect(v.priceClusters!.status).toBe("not-applicable");
  });
  it("is quarantined when GeckoTerminal's pools independently corroborate the real range", () => {
    const d = dex();
    const realPools = d.observations.filter(o => (o.priceUsd ?? 0) > 0 && (o.priceUsd ?? 0) < 1 && !o.identityError).slice(0, 8)
      .map(o => ({ ...o, provider: "geckoterminal" }));
    const v = validateMarket(captured.mint, [d, { provider: "geckoterminal", mint: captured.mint, available: true, fetchedAt: NOW, observations: realPools, token: null, errors: [] }], [], NOW, 6861486518.571356);
    expect(v.price.value).not.toBeNull();
    expect(v.price.value!).toBeLessThan(1);
    const quarantinedPools = v.priceClusters!.quarantined.flatMap(q => q.pools);
    for (const o of d.observations.filter(o => (o.priceUsd ?? 0) > 1000)) expect(quarantinedPools).toContain(o.pairAddress);
    expect(v.marketCap.value === null || v.marketCap.value < 1e11).toBe(true);
  });
});

describe("rate-limit reliability", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); clearRetainedResponses(); });
  it("a history/chart HTTP 429 cannot remove already-measured scored metrics", () => {
    const v = validate(snap("dexscreener", good(3)), snap("geckoterminal", good(3)));
    const after = withHistory({ ...v, historyPool: { pairAddress: "good-0", dexId: "dex" } }, { available: false, points: [], pool: "good-0", mint: MINT, side: "base",
      fetchedAt: NOW, sourceUrl: "https://fixture.invalid", error: "Market service returned HTTP 429" }, NOW);
    expect(after.historyCheck.status).toBe("unavailable");
    expect(after.price.value).toBe(v.price.value);
    expect(scored(after).map(s => s.status)).toEqual(scored(v).map(s => s.status));
  });
  it("a temporary 429 reuses a still-fresh success with its ORIGINAL timestamp; stale or error responses are never reused", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const responses = [new Response(JSON.stringify({ ok: 1 }), { status: 200 }), new Response("", { status: 429 }), new Response("", { status: 429 }), new Response("", { status: 429 })];
    const fetchMock = vi.fn(async () => responses.shift()!);
    vi.stubGlobal("fetch", fetchMock);
    const url = "https://fixture.invalid/retain";
    const first = await marketJson(url);
    expect(first).toMatchObject({ body: { ok: 1 }, fetchedAt: NOW, error: null });
    vi.setSystemTime(NOW + 30_000);
    const reused = await marketJson(url);
    expect(reused).toMatchObject({ body: { ok: 1 }, fetchedAt: NOW, error: null });
    expect(reused.events.join(" ")).toContain("reused a successful response from 30s earlier");
    vi.setSystemTime(NOW + MAX_SNAPSHOT_AGE_MS + 1);
    const pending = marketJson(url);
    await vi.advanceTimersByTimeAsync(2000);
    const stale = await pending;
    expect(stale.body).toBeNull();
    expect(stale.error).toBe("Market service returned HTTP 429");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("an error is never cached as successful evidence", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429 })));
    const pending = marketJson("https://fixture.invalid/never-ok");
    await vi.advanceTimersByTimeAsync(2000);
    expect((await pending).body).toBeNull();
    const again = marketJson("https://fixture.invalid/never-ok");
    await vi.advanceTimersByTimeAsync(2000);
    expect((await again).error).toBe("Market service returned HTTP 429");
  });
});

describe("versioning and unchanged neighbours", () => {
  it("v2.7 invalidates older cached reports and Signal 14 is unchanged", () => {
    expect(MARKET_ALGORITHM_VERSION).toBe("market-integrity-v2.7");
    expect(reportCacheKey(MINT)).toBe("market-integrity-v2.7:report:" + MINT);
    const report = buildRiskReport(makeInput({ rugCheck: cleanRugCheck() }), { overview: {} as never, sources: [], elapsedMs: 0 });
    expect(report.signals).toHaveLength(14);
    expect(report.totalWeight).toBe(152);
    expect(report.signals.find(s => s.id === "rug-security")).toMatchObject({ maxPoints: 0, points: 0, label: "Rug / Security Risk" });
  });
});
