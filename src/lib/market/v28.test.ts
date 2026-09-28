import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
import captured from "./fixtures/jup-2026-09-27.json";
import { normalizeDexScreener } from "../providers/dexscreener";
import { geckoReferencesFromPools, getGeckoSnapshot } from "../providers/gecko-market";
import { marketJson, clearRetainedResponses, RATE_LIMIT_COOLDOWN_MS } from "../providers/market-http";
import { validateMarket, withDayReturn } from "./validation";
import { marketValuation } from "./access";
import { MARKET_ALGORITHM_VERSION } from "./policy";
import { liquidityDepthRule, liquidityRatioRule, poolDiversityRule } from "../risk-engine/rules/liquidity";
import { tradingActivityRule, tradeImbalanceRule, priceVolatilityRule } from "../risk-engine/rules/market";
import { poolMaturityRule } from "../risk-engine/rules/maturity";
import { makeInput, cleanRugCheck } from "../risk-engine/test-fixtures";
import { buildRiskReport, RULES } from "../risk-engine/engine";
import type { MarketData, MarketValidation, PoolObservation, PriceHistory, ProviderSnapshot } from "./types";

const NOW = Date.parse(captured.capturedAt);
const HOUR = 3_600_000;
const MINT = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
function row(overrides: Partial<PoolObservation> = {}): PoolObservation {
  return { provider: "a", chain: "solana", dexId: "dex", pairAddress: "good-0", requestedMint: MINT,
    baseAddress: MINT, baseSymbol: "TKN", quoteAddress: USDC, quoteSymbol: "USDC", side: "base", counterMint: USDC,
    trustedCounterMint: true, priceNative: 1, requestedNativeRatio: 1, reportedPriceUsd: 1, priceUsd: 1,
    liquidityUsd: 100000, volume24hUsd: 10000, reportedChange24h: null, priceChange24h: null, buys24h: 100, sells24h: 100,
    pairCreatedAt: NOW - 400 * 86400000, marketCap: null, fdv: null, fetchedAt: NOW, providerUpdatedAt: null,
    sourceUrl: "https://fixture.invalid", identityError: null, info: { imageUrl: null, websites: [], socials: [] }, ...overrides };
}
const snap = (provider: string, observations: PoolObservation[], overrides: Partial<ProviderSnapshot> = {}): ProviderSnapshot =>
  ({ provider, mint: MINT, available: true, fetchedAt: NOW, observations: observations.map(o => ({ ...o, provider })), token: null, errors: [], ...overrides });
const pools = (n: number, over: Partial<PoolObservation> = {}, prefix = "good") => Array.from({ length: n }, (_, i) => row({ pairAddress: `${prefix}-${i}`, ...over }));
const run = (a: PoolObservation[], b: PoolObservation[], supply: number | null = 2e6) => validateMarket(MINT, [snap("dexscreener", a), snap("geckoterminal", b)], [], NOW, supply);
const market = (v: MarketValidation): MarketData => ({ available: true, pairs: v.pairs, validation: v, name: null, symbol: null, imageUrl: null, websites: [], socials: [] });
function signals(v: MarketValidation, supplyIsMeaningful = true) {
  const input = makeInput({ mintInfo: { ...makeInput().mintInfo, supplyUi: 2e6, supplyIsMeaningful } });
  input.marketData = market(v);
  return Object.fromEntries([liquidityDepthRule, liquidityRatioRule, poolDiversityRule, tradingActivityRule, tradeImbalanceRule, priceVolatilityRule, poolMaturityRule]
    .map(rule => { const s = rule(input); return [s.id, s]; }));
}

describe("underlying-market independence (same physical pool read by two APIs)", () => {
  it("one thin pool indexed by both providers does not establish a second market against a diversified one", () => {
    const thin = row({ pairAddress: "thin-shared", priceUsd: 0.86, liquidityUsd: 1250 });
    const v = run([...pools(4), thin], [...pools(4), thin]);
    expect(v.priceClusters).toMatchObject({ status: "single-market", duplicatedPools: ["thin-shared"] });
    expect(v.price).toMatchObject({ status: "validated", value: 1 });
    expect(v.pairs.map(p => p.pairAddress)).not.toContain("thin-shared");
    expect(Object.values(signals(v)).filter(s => s.id !== "price-volatility").every(s => s.status === "ok")).toBe(true);
  });
  it("two genuinely independent incompatible markets (distinct pools, each read by both providers) stay blocked", () => {
    const other = pools(2, { priceUsd: 0.5 }, "other");
    const v = run([...pools(3), ...other], [...pools(3), ...other]);
    expect(v.priceClusters!.status).toBe("corroborated-conflict");
    expect(v.price.value).toBeNull();
  });
  it("several single-provider corrupt pools cannot out-rank one cross-read real pool (no count winner)", () => {
    const corruptA = pools(3, { priceUsd: 1638, liquidityUsd: 1e9 }, "corrupt-a"), corruptB = pools(1, { priceUsd: 1638, liquidityUsd: 1e9 }, "corrupt-b");
    const v = run([row(), ...corruptA], [row(), ...corruptB]);
    expect(v.price.value).toBeNull();
    expect(v.priceClusters!.status).toBe("corroborated-conflict");
  });
  it("a duplicated single pool deeper than the diversified market is not discarded (conservative veto)", () => {
    const deep = row({ pairAddress: "deep-shared", priceUsd: 0.8, liquidityUsd: 5e6 });
    const v = run([...pools(3), deep], [...pools(3), deep]);
    expect(v.price.value).toBeNull();
    expect(v.priceClusters!.reason).toContain("holds at least as much liquidity");
  });
  it("a provider's internal split into sub-clusters of ONE corroborated market is not a conflict (chained-cluster artifact)", () => {
    // Provider A: a continuous 0.57–0.638 spread splits into two chained clusters; provider B spans the same market.
    const a = [...pools(3, { priceUsd: 0.59 }), row({ pairAddress: "low", priceUsd: 0.57 }), row({ pairAddress: "hi-1", priceUsd: 0.6324 }), row({ pairAddress: "hi-2", priceUsd: 0.6376 })];
    const b = [...pools(3, { priceUsd: 0.597 }), row({ pairAddress: "b-hi", priceUsd: 0.6198 })];
    const v = run(a, b);
    expect(v.priceClusters!.status).toBe("single-market");
    expect(v.price.status).toBe("validated");
    expect(v.price.value!).toBeGreaterThan(0.58); expect(v.price.value!).toBeLessThan(0.61);
  });
  it("a candidate beyond the corroborated market center tolerance still blocks", () => {
    const tokenFar = { provider: "dexscreener", mint: MINT, priceUsd: 1.5, marketCap: null, fetchedAt: NOW, sourceUrl: "x" };
    const v = validateMarket(MINT, [snap("dexscreener", pools(3), { token: tokenFar }), snap("geckoterminal", pools(3))], [], NOW, 2e6);
    // The outlying token endpoint is quarantined rather than voting; the market price is unaffected.
    expect(v.priceClusters!.quarantinedTokens).toEqual(["dexscreener"]);
    expect(v.price.value).toBe(1);
  });
  it("row count alone never selects: a diversified market still needs cross-provider pools", () => {
    const v = run(pools(10), [row({ pairAddress: "elsewhere", priceUsd: 7 })]);
    expect(v.price.value).toBeNull();
  });
  it("the historical JUP ~$1,638 pools never enter price, market cap or liquidity", () => {
    const dex = normalizeDexScreener(captured.dex, captured.mint, NOW);
    const real = dex.observations.filter(o => (o.priceUsd ?? 0) > 0 && (o.priceUsd ?? 0) < 1 && !o.identityError).slice(0, 8).map(o => ({ ...o, provider: "geckoterminal" }));
    const corrupt = dex.observations.filter(o => (o.priceUsd ?? 0) > 1000).map(o => ({ ...o, provider: "geckoterminal" }));
    for (const gecko of [real, [...real, ...corrupt.slice(0, 1)], [...real, ...corrupt]]) {
      const v = validateMarket(captured.mint, [dex, { provider: "geckoterminal", mint: captured.mint, available: true, fetchedAt: NOW, observations: gecko, token: null, errors: [] }], [], NOW, 6861486518.571356);
      expect(v.price.value === null || v.price.value < 1).toBe(true);
      expect(v.valuation.value === null || v.valuation.value < 1e10).toBe(true);
      expect(v.pairs.every(p => (p.priceUsd ?? 0) < 1 && p.liquidityUsd < 1e8)).toBe(true);
    }
  });
});

describe("rate-limit reliability", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); clearRetainedResponses(); });
  it("after a 429 with Retry-After: 0 the host cools down: fresh cache is served without a request, optional requests are skipped", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: 1 }), { status: 200 }))
      .mockResolvedValue(new Response("", { status: 429, headers: { "retry-after": "0" } }));
    vi.stubGlobal("fetch", fetchMock);
    await marketJson("https://provider.invalid/a");
    vi.setSystemTime(NOW + 10_000);
    const limited = await marketJson("https://provider.invalid/b");
    expect(limited.error).toContain("429");
    expect(fetchMock).toHaveBeenCalledTimes(2); // no immediate re-hit on Retry-After: 0
    const cached = await marketJson("https://provider.invalid/a");
    expect(cached).toMatchObject({ body: { ok: 1 }, fetchedAt: NOW, cached: true });
    const optional = await marketJson("https://provider.invalid/chart", { optional: true });
    expect(optional.error).toContain("optional request skipped");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.setSystemTime(NOW + 10_000 + RATE_LIMIT_COOLDOWN_MS + 1);
    await marketJson("https://provider.invalid/c");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("a provider snapshot survives a temporary 429 from fresh cache with its original timestamp; a stale one does not", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const token = { data: { id: "solana_" + MINT, attributes: { address: MINT, price_usd: "1" } } };
    const poolsBody = { data: [], included: [] };
    const ok = vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes("/pools") ? poolsBody : token), { status: 200 }));
    vi.stubGlobal("fetch", ok);
    const first = await getGeckoSnapshot(MINT);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429, headers: { "retry-after": "0" } })));
    vi.setSystemTime(NOW + 40_000);
    const second = await getGeckoSnapshot(MINT);
    expect(second.available).toBe(true);
    expect(second.token?.fetchedAt).toBe(first.token?.fetchedAt);
    expect(second.errors.join(" ")).toContain("reused a successful response");
    vi.setSystemTime(NOW + 200_000);
    const stale = await getGeckoSnapshot(MINT);
    expect(stale.token).toBeNull();
  });
  it("counter-reference failure does not remove unrelated metrics", () => {
    const withRefs = validateMarket(MINT, [snap("dexscreener", pools(3)), snap("geckoterminal", pools(3))],
      [{ provider: "geckoterminal", mint: USDC, priceUsd: 1, marketCap: null, fetchedAt: NOW, sourceUrl: "x" }], NOW, 2e6);
    const withoutRefs = validateMarket(MINT, [snap("dexscreener", pools(3)), snap("geckoterminal", pools(3))], [], NOW, 2e6);
    expect(Object.values(signals(withoutRefs)).map(s => s.status)).toEqual(Object.values(signals(withRefs)).map(s => s.status));
  });
  it("counter references are derived from GeckoTerminal pool rows when they agree, otherwise requested", () => {
    const rows = [row({ provider: "geckoterminal", reportedCounterPriceUsd: 1.0 }), row({ provider: "geckoterminal", pairAddress: "g2", reportedCounterPriceUsd: 1.001 }),
      row({ provider: "geckoterminal", pairAddress: "g3", counterMint: "X", reportedCounterPriceUsd: 5 }), row({ provider: "geckoterminal", pairAddress: "g4", counterMint: "X", reportedCounterPriceUsd: 9 })];
    const refs = geckoReferencesFromPools(rows, [USDC, "X", "Y"]);
    expect(refs.map(r => r.mint)).toEqual([USDC]);
  });
});

describe("valuation hierarchy for Liquidity vs Market Cap", () => {
  it("validated circulating market cap stays preferred", () => {
    const v = run(pools(2, { marketCap: 1.5e6 }), pools(2, { marketCap: 1.5e6 }));
    expect(v.valuation.basis).toBe("circulating-market-cap");
    expect(signals(v)["liquidity-ratio"].observedValue).toBe("13.33% of market cap");
  });
  it("a circulation conflict falls back to a labelled on-chain supply valuation", () => {
    const v = run(pools(2, { marketCap: 1e6 }), pools(2, { marketCap: 1.8e6 }));
    expect(v.marketCap.value).toBeNull();
    expect(marketValuation(market(v), 2e6)).toEqual({ value: 2e6, basis: "on-chain-supply-valuation" });
    const ratio = signals(v)["liquidity-ratio"];
    expect(ratio.observedValue).toBe("10.00% of on-chain supply valuation");
    expect(ratio.evidence.find(e => e.label === "Valuation basis")?.value).toContain("Validated price × current on-chain minted supply");
    expect(JSON.stringify(ratio)).not.toMatch(/circulating market cap: validated/i);
  });
  it("no fallback without a validated canonical price", () => {
    const v = validateMarket(MINT, [snap("dexscreener", pools(2))], [], NOW, 2e6);
    expect(v.valuation.value).toBeNull();
    expect(signals(v)["liquidity-ratio"].status).toBe("unavailable");
  });
  it("non-meaningful or invalid supply cannot be used", () => {
    const v = run(pools(2), pools(2), null);
    expect(v.valuation.basis).toBeNull();
    expect(signals(v, false)["liquidity-ratio"].status).toBe("unavailable");
    expect(marketValuation(market(run(pools(2), pools(2), 2e6)), 0)).toBeNull();
    expect(marketValuation(market(run(pools(2), pools(2), 2e6)), undefined)).toBeNull();
  });
});

describe("24h movement from requested-mint USD history", () => {
  /** Hourly closes: index 0 opens 25 h ago (closes exactly 24 h ago); the last is the current hour. */
  const history = (pool: string, reference: number, latest: number, side: "base" | "quote" = "base", mint = MINT, lagHours = 0): PriceHistory => ({
    available: true, mint, pool, side, fetchedAt: NOW, sourceUrl: "https://fixture.invalid",
    points: Array.from({ length: 26 }, (_, i) => ({ t: NOW - 25 * HOUR + i * HOUR - lagHours * HOUR, p: i === 0 ? reference : i === 25 ? latest : (reference + latest) / 2 })),
  });
  const noReturn = () => run(pools(2), pools(2));
  it("measures movement when provider returns are unavailable but valid history exists (base side)", () => {
    const v = noReturn();
    expect(v.change24h.status).not.toBe("validated");
    const out = withDayReturn(v, history("good-0", 0.8, 1), NOW);
    expect(out.change24h).toMatchObject({ status: "validated" });
    expect(out.change24h.value).toBeCloseTo(25, 6);
    expect(out.dayReturn).toMatchObject({ status: "validated", referencePriceUsd: 0.8, referenceTime: NOW - 24 * HOUR });
    expect(signals(out)["price-volatility"]).toMatchObject({ status: "ok", observedValue: "+25.00% in 24h" });
  });
  it("works for a quote-side requested mint and a stablecoin (series is native USD for the mint, never inverted)", () => {
    const quote = run(pools(2, { side: "quote", baseAddress: USDC, quoteAddress: MINT }), pools(2, { side: "quote", baseAddress: USDC, quoteAddress: MINT }));
    expect(withDayReturn(quote, history("good-0", 1.25, 1, "quote"), NOW).change24h.value).toBeCloseTo(-20, 6);
    const stable = withDayReturn(noReturn(), history("good-0", 1.0006, 1.0001), NOW);
    expect(stable.change24h.status).toBe("validated");
    expect(Math.abs(stable.change24h.value!)).toBeLessThan(0.1);
  });
  it("stale or insufficient history leaves movement unavailable", () => {
    expect(withDayReturn(noReturn(), history("good-0", 0.8, 1, "base", MINT, 3), NOW).change24h.status).not.toBe("validated");
    const short: PriceHistory = { ...history("good-0", 0.8, 1), points: history("good-0", 0.8, 1).points.slice(12) };
    expect(withDayReturn(noReturn(), short, NOW).dayReturn!.reason).toContain("no hourly close within one hour of 24 h ago");
    expect(withDayReturn(noReturn(), { ...history("good-0", 0.8, 1), points: [], error: "Market service returned HTTP 429" }, NOW).change24h.status).not.toBe("validated");
  });
  it("a corrupt/outlier pool cannot determine movement", () => {
    expect(withDayReturn(noReturn(), history("not-corroborated", 0.8, 1), NOW).dayReturn!.reason).toContain("not for the requested mint on a corroborated pool");
    expect(withDayReturn(noReturn(), history("good-0", 0.001, 1638), NOW).dayReturn!.reason).toContain("does not match validated spot");
    expect(withDayReturn(noReturn(), history("good-0", 0.8, 1, "base", USDC), NOW).change24h.status).not.toBe("validated");
  });
  it("same-pool provider return corroborates, and a contradiction blocks", () => {
    // Two equal-depth pools whose returns disagree: provider and subset methods cannot validate.
    const split = (a: number, b: number) => run([row({ pairAddress: "p-a", priceChange24h: a }), row({ pairAddress: "p-b", priceChange24h: b })],
      [row({ pairAddress: "p-a", priceChange24h: a }), row({ pairAddress: "p-b", priceChange24h: b })]);
    const v = split(25, 90);
    expect(v.change24h.status).not.toBe("validated");
    expect(withDayReturn(v, history("p-a", 0.8, 1), NOW).dayReturn).toMatchObject({ status: "validated", samePoolReturn: 1.25 });
    expect(withDayReturn(v, history("p-a", 0.5, 1), NOW).change24h.status).toBe("conflict");
  });
  it("an already validated provider return is kept", () => {
    const v = run(pools(2, { priceChange24h: 3 }), pools(2, { priceChange24h: 3 }));
    expect(withDayReturn(v, history("good-0", 0.5, 1), NOW).change24h.value).toBeCloseTo(3, 6);
  });
});

describe("unchanged neighbours", () => {
  it("v2.8, Signal 14 / RugCheck and all rule weights unchanged", () => {
    expect(MARKET_ALGORITHM_VERSION).toBe("market-integrity-v2.8");
    const report = buildRiskReport(makeInput({ rugCheck: cleanRugCheck() }), { overview: {} as never, sources: [], elapsedMs: 0 });
    expect(RULES).toHaveLength(14);
    expect(report.signals.map(s => [s.id, s.maxPoints])).toEqual([
      ["mint-authority", 20], ["freeze-authority", 14], ["token-extensions", 18], ["metadata-mutability", 6], ["rug-security", 0],
      ["top-holder", 18], ["holder-spread", 10], ["liquidity-depth", 16], ["liquidity-ratio", 10], ["pool-diversity", 6],
      ["trading-activity", 10], ["trade-imbalance", 6], ["price-volatility", 6], ["pool-maturity", 12],
    ]);
    expect(report.totalWeight).toBe(152);
  });
});
