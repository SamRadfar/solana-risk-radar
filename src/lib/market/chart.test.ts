import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
import { buildChart, chartAcceptance, chartCandidates, MAX_CHART_POOLS } from "./chart";
import { validateMarket, withHistory } from "./validation";
import { getPriceHistory } from "../providers/geckoterminal";
import { clearRetainedResponses } from "../providers/market-http";
import { makeInput } from "../risk-engine/test-fixtures";
import { buildRiskReport } from "../risk-engine/engine";
import type { MarketData, MarketValidation, PoolObservation, PriceHistory, ProviderSnapshot } from "./types";

const NOW = Date.parse("2026-09-28T12:00:00Z");
const MINT = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
function row(overrides: Partial<PoolObservation> = {}): PoolObservation {
  return { provider: "a", chain: "solana", dexId: "dex", pairAddress: "pool-0", requestedMint: MINT,
    baseAddress: MINT, baseSymbol: "TKN", quoteAddress: USDC, quoteSymbol: "USDC", side: "base", counterMint: USDC,
    trustedCounterMint: true, priceNative: 1, requestedNativeRatio: 1, reportedPriceUsd: 1, priceUsd: 1,
    liquidityUsd: 100000, volume24hUsd: 10000, reportedChange24h: 1, priceChange24h: 1, buys24h: 100, sells24h: 100,
    pairCreatedAt: NOW - 400 * 86400000, marketCap: null, fdv: null, fetchedAt: NOW, providerUpdatedAt: null,
    sourceUrl: "https://fixture.invalid", identityError: null, info: { imageUrl: null, websites: [], socials: [] }, ...overrides };
}
const snap = (provider: string, observations: PoolObservation[]): ProviderSnapshot =>
  ({ provider, mint: MINT, available: true, fetchedAt: NOW, observations: observations.map(o => ({ ...o, provider })), token: null, errors: [] });
const pools = [row({ pairAddress: "deep", liquidityUsd: 900000, dexId: "orca" }), row({ pairAddress: "mid", liquidityUsd: 300000, dexId: "raydium" }),
  row({ pairAddress: "thin", liquidityUsd: 5000, dexId: "meteora" }), row({ pairAddress: "tiny", liquidityUsd: 2000 })];
const validation = () => validateMarket(MINT, [snap("dexscreener", pools), snap("geckoterminal", pools)], [], NOW, 2e6);
const series = (pool: string, overrides: Partial<PriceHistory> = {}, latest = 1): PriceHistory => ({
  available: true, mint: MINT, pool, side: "base", fetchedAt: NOW, sourceUrl: "https://fixture.invalid",
  points: Array.from({ length: 12 }, (_, i) => ({ t: NOW - (11 - i) * 5 * 60_000, p: i === 11 ? latest : 0.99 })), ...overrides });

describe("4H chart pool selection (display only)", () => {
  it("uses corroborated pools, deepest first, at most three", () => {
    expect(chartCandidates(validation()).map(c => c.pairAddress)).toEqual(["deep", "mid", "thin"]);
    expect(MAX_CHART_POOLS).toBe(3);
  });
  it("the deepest pool's usable history is the chart", () => {
    const chart = buildChart(validation(), [{ pool: "deep", dexId: "orca", history: series("deep") }], null);
    expect(chart).toMatchObject({ status: "available", pool: "deep", dexId: "orca", fetchedAt: NOW });
    expect(chart.points).toHaveLength(12);
  });
  it("falls back to the next verified pool when the deepest has no usable history", () => {
    const chart = buildChart(validation(), [
      { pool: "deep", dexId: "orca", history: series("deep", { available: false, points: [], error: "Fewer than six identified closes in the four-hour window" }) },
      { pool: "mid", dexId: "raydium", history: series("mid") },
    ], null);
    expect(chart).toMatchObject({ status: "available", pool: "mid", dexId: "raydium" });
    expect(chart.attempts.map(a => a.outcome)).toEqual(["Fewer than six identified closes in the four-hour window", "accepted"]);
  });
  it("a rate-limited attempt defers to the client with the candidate pools and a retry hint", () => {
    const chart = buildChart(validation(), [{ pool: "deep", dexId: "orca", history: series("deep", { available: false, points: [], error: "Provider rate limit cooldown; optional request skipped", transient: true }) }], 12_000);
    expect(chart).toMatchObject({ status: "deferred", retryAfterMs: 12_000, points: [] });
    expect(chart.candidates.map(c => c.pairAddress)).toEqual(["deep", "mid", "thin"]);
  });
  it("reports the exact reason when no verified pool has usable history", () => {
    const chart = buildChart(validation(), ["deep", "mid", "thin"].map(pool => ({ pool, dexId: "x", history: series(pool, { available: false, points: [], error: "Malformed history" }) })), null);
    expect(chart.status).toBe("unavailable");
    expect(chart.reason).toBe("deep…: Malformed history; mid…: Malformed history; thin…: Malformed history");
  });
});

describe("4H chart acceptance", () => {
  it("accepts base-side and quote-side requested-mint USD series (never an inverted token)", () => {
    expect(chartAcceptance(series("deep"), MINT, "deep", 1)).toEqual({ ok: true });
    expect(chartAcceptance(series("deep", { side: "quote" }), MINT, "deep", 1)).toEqual({ ok: true });
  });
  it("rejects wrong mint, wrong pool, unproven orientation and too few points", () => {
    expect(chartAcceptance(series("deep", { mint: USDC }), MINT, "deep", 1).ok).toBe(false);
    expect(chartAcceptance(series("deep"), MINT, "mid", 1).ok).toBe(false);
    expect(chartAcceptance(series("deep", { side: null }), MINT, "deep", 1).ok).toBe(false);
    expect(chartAcceptance(series("deep", { points: series("deep").points.slice(0, 5), available: false }), MINT, "deep", 1).ok).toBe(false);
  });
  it("a stale or mispriced pool is never drawn as the token's market", () => {
    expect(chartAcceptance(series("deep", {}, 1638), MINT, "deep", 1)).toMatchObject({ ok: false, reason: "Latest close is inconsistent with the validated price" });
    expect(chartAcceptance(series("deep"), MINT, "deep", null).ok).toBe(false);
  });
  it("no chart for a market conflict or without a validated price", () => {
    const v = validation();
    const conflicted = withHistory({ ...v, historyPool: { pairAddress: "deep", dexId: "orca" } }, series("deep", {}, 1638), NOW);
    expect(buildChart(conflicted, [], null)).toMatchObject({ status: "unavailable", reason: "Market data conflict" });
    const single = validateMarket(MINT, [snap("dexscreener", pools)], [], NOW, 2e6);
    expect(buildChart(single, [], null)).toMatchObject({ status: "unavailable", reason: "No validated price, so no verified pool to chart" });
  });
});

describe("chart is separate from scoring", () => {
  it("chart availability never changes any risk signal, score or coverage", () => {
    const v = validation();
    const withChart = (chart: MarketValidation["chart"]) => {
      const input = makeInput(); input.marketData = { available: true, pairs: v.pairs, validation: { ...v, chart }, name: null, symbol: null, imageUrl: null, websites: [], socials: [] } as MarketData;
      return buildRiskReport(input, { overview: {} as never, sources: [], elapsedMs: 0 });
    };
    const shown = withChart(buildChart(v, [{ pool: "deep", dexId: "orca", history: series("deep") }], null));
    const missing = withChart(buildChart(v, [{ pool: "deep", dexId: "orca", history: { ...series("deep"), points: [], available: false, transient: true, error: "HTTP 429" } }], 5000));
    expect(shown.market.chart?.status).toBe("available");
    expect(missing.market.chart?.status).toBe("deferred");
    const strip = (r: typeof shown) => ({ signals: r.signals, score: r.score, coverage: r.coveragePercent, classification: r.classification });
    expect(strip(missing)).toEqual(strip(shown));
  });
});

describe("history transport failures are transient, never successful evidence", () => {
  afterEach(() => { vi.unstubAllGlobals(); clearRetainedResponses(); });
  it("a 429 is marked transient (so /api/history never caches it); a data error is not", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429, headers: { "retry-after": "0" } })));
    const limited = await getPriceHistory(MINT, "deep");
    expect(limited).toMatchObject({ transient: true, available: false, points: [] });
    clearRetainedResponses();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ meta: { base: { address: USDC }, quote: { address: USDC } }, data: {} }))));
    const bad = await getPriceHistory(MINT, "deep");
    expect(bad.transient).toBeUndefined();
    expect(bad.available).toBe(false);
  });
});
