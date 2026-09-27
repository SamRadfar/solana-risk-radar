import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import captured from "./fixtures/jup-2026-09-27.json";
import { normalizeDexScreener } from "../providers/dexscreener";
import { normalizeGeckoToken } from "../providers/gecko-market";
import { validateMarket, withHistory, weightedMedian } from "./validation";
import { MARKET_ALGORITHM_VERSION, MIN_SUBSET_LIQUIDITY_SHARE } from "./policy";
import { liquidityDepthRule, liquidityRatioRule, poolDiversityRule } from "../risk-engine/rules/liquidity";
import { tradingActivityRule, tradeImbalanceRule, priceVolatilityRule } from "../risk-engine/rules/market";
import { poolMaturityRule } from "../risk-engine/rules/maturity";
import { makeInput, cleanRugCheck } from "../risk-engine/test-fixtures";
import { buildRiskReport } from "../risk-engine/engine";
import type { AnalysisInput } from "../risk-engine/input";
import type { MarketData, MarketValidation, PoolObservation, ProviderSnapshot } from "./types";

const NOW = Date.parse(captured.capturedAt);
const MINT = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
function row(overrides: Partial<PoolObservation> = {}): PoolObservation {
  return { provider: "a", chain: "solana", dexId: "dex", pairAddress: "pool-1", requestedMint: MINT,
    baseAddress: MINT, baseSymbol: "SOL", quoteAddress: USDC, quoteSymbol: "USDC", side: "base", counterMint: USDC,
    trustedCounterMint: true, priceNative: 1, requestedNativeRatio: 1, reportedPriceUsd: 1, priceUsd: 1,
    liquidityUsd: 100000, volume24hUsd: 10000, reportedChange24h: 2, priceChange24h: 2, buys24h: 100, sells24h: 100,
    pairCreatedAt: NOW - 400 * 86400000, marketCap: 1000000, fdv: 2000000, fetchedAt: NOW, providerUpdatedAt: null,
    sourceUrl: "https://fixture.invalid", identityError: null, info: { imageUrl: null, websites: [], socials: [] }, ...overrides };
}
function snap(provider: string, observations: PoolObservation[], overrides: Partial<ProviderSnapshot> = {}): ProviderSnapshot {
  return { provider, mint: MINT, available: true, fetchedAt: NOW, observations: observations.map(o => ({ ...o, provider })), token: null, errors: [], ...overrides };
}
/** Both providers observe the same pools; per-provider overrides model disagreement. */
function both(pools: Partial<PoolObservation>[], a: Record<number, Partial<PoolObservation>> = {}, b: Record<number, Partial<PoolObservation>> = {}) {
  return validateMarket(MINT, [
    snap("dexscreener", pools.map((p, i) => row({ pairAddress: "pool-" + i, ...p, ...(a[i] ?? {}) }))),
    snap("geckoterminal", pools.map((p, i) => row({ pairAddress: "pool-" + i, ...p, ...(b[i] ?? {}) }))),
  ], [], NOW, 2e6);
}
const market = (v: MarketValidation): MarketData => ({ available: true, pairs: v.pairs, validation: v, name: null, symbol: null, imageUrl: null, websites: [], socials: [] });
/** makeInput() rebuilds validation from pairs, so the validation under test is attached afterwards. */
function input(v: MarketValidation): AnalysisInput {
  const built = makeInput({ mintInfo: { ...makeInput().mintInfo, supplyUi: 2e6, supplyIsMeaningful: true } });
  built.marketData = market(v);
  return built;
}
const rules = { depth: liquidityDepthRule, ratio: liquidityRatioRule, diversity: poolDiversityRule, activity: tradingActivityRule, imbalance: tradeImbalanceRule, movement: priceVolatilityRule, age: poolMaturityRule };
const signals = (v: MarketValidation) => Object.fromEntries(Object.entries(rules).map(([k, rule]) => [k, rule(input(v))])) as Record<keyof typeof rules, ReturnType<typeof liquidityDepthRule>>;

describe("metric-specific market validation (no all-or-nothing)", () => {
  it("liquidity stays valid while volume is unavailable", () => {
    const s = signals(both([{ volume24hUsd: null }, { volume24hUsd: null, liquidityUsd: 50000 }]));
    expect(s.depth).toMatchObject({ status: "ok", observedValue: "$150.00K across 2 pools" });
    expect(s.diversity.status).toBe("ok");
    expect(s.activity.status).toBe("unavailable");
    expect(s.activity.explanation).toContain("Independently validated 24h volume was unavailable");
  });

  it("volume is measured on a compatible pool subset: turnover never mixes volume and liquidity from different pools", () => {
    const v = both([{ liquidityUsd: 400000, volume24hUsd: 200000 }, { liquidityUsd: 100000, volume24hUsd: 100000 }, { liquidityUsd: 20000, volume24hUsd: 5000 }],
      { 2: { volume24hUsd: 13_000_000 } });
    expect(v.volume24h).toMatchObject({ status: "validated", value: 300000 });
    expect(v.volumeSubset).toMatchObject({ poolsMeasured: 2, poolsCorroborated: 3, liquidityUsd: 500000, excluded: [{ pairAddress: "pool-2" }] });
    expect(v.volumeSubset!.liquidityShare).toBeCloseTo(500000 / 520000);
    const s = signals(v);
    expect(s.activity.observedValue).toBe("$300.00K in 24h (0.60x liquidity)");
    expect(s.activity.evidence).toContainEqual({ label: "Liquidity of the same pools", value: "$500.00K" });
    expect(s.depth.observedValue).toBe("$520.00K across 3 pools");
  });

  it("a subset without a majority of corroborated reserves is withheld, not published as the market", () => {
    const v = both([{ liquidityUsd: 400000 }, { liquidityUsd: 100000 }], { 0: { volume24hUsd: 13_000_000 } });
    expect(MIN_SUBSET_LIQUIDITY_SHARE).toBe(0.5);
    expect(v.volume24h.status).toBe("conflict");
    expect(v.volume24h.reason).toContain("covers only 20.0% of corroborated reserves (1 of 2 pools); a majority is required");
    expect(v.volumeSubset).toBeNull();
    expect(signals(v).activity.status).toBe("unavailable");
    expect(v.liquidity.status).toBe("validated");
  });

  it("buy/sell unavailable does not destroy liquidity, and the wording states the real failure", () => {
    const v = both([{}, {}], { 0: { sells24h: 500 }, 1: { sells24h: 500 } });
    const s = signals(v);
    expect(v.activity.status).toBe("conflict");
    expect(s.imbalance.status).toBe("unavailable");
    expect(s.imbalance.explanation).toContain("Independently validated buy/sell activity was unavailable");
    expect(s.depth.status).toBe("ok");
    expect(s.activity.status).toBe("ok");
  });

  it("buy/sell is measured only on pools with defensible counts", () => {
    const v = both([{ liquidityUsd: 900000, buys24h: 300, sells24h: 100 }, { liquidityUsd: 10000 }], { 1: { buys24h: 999 } });
    expect(v.activitySubset).toMatchObject({ buys: 300, sells: 100, poolsMeasured: 1, poolsCorroborated: 2 });
    expect(signals(v).imbalance.observedValue).toBe("25.0% sells (300 buys / 100 sells)");
  });

  it("the misleading 'No liquidity pool was found' message is gone even when pools exist", () => {
    const outputs = [both([{ volume24hUsd: null, buys24h: null, sells24h: null }]), both([{}], { 0: { sells24h: 900 } })]
      .flatMap(v => Object.values(signals(v)).map(s => s.explanation));
    expect(outputs.join(" ")).not.toContain("No liquidity pool was found");
  });

  it("a 24h return conflict does not destroy Pool Age or liquidity", () => {
    // Two equal-depth pools that genuinely disagree: no depth majority, so the return stays withheld.
    const v = both([{ priceChange24h: 2 }, { priceChange24h: 40 }]);
    const s = signals(v);
    expect(s.movement.status).toBe("unavailable");
    expect(s.age).toMatchObject({ status: "ok" });
    expect(s.depth.status).toBe("ok");
  });

  it("pool timestamps stand independently of missing activity fields", () => {
    const s = signals(both([{ volume24hUsd: null, buys24h: null, sells24h: null, priceChange24h: null }]));
    expect(s.age.status).toBe("ok");
    expect(s.activity.status).toBe("unavailable");
    expect(s.imbalance.status).toBe("unavailable");
  });

  it("a circulating-supply conflict is isolated to market-cap-dependent metrics", () => {
    const v = both([{}, {}], {}, { 0: { marketCap: 1.6e6 }, 1: { marketCap: 1.6e6 } });
    expect(v.marketCap.status).toBe("conflict");
    const s = signals(v);
    expect(s.ratio.status).toBe("unavailable");
    for (const k of ["depth", "diversity", "activity", "imbalance", "movement", "age"] as const) expect(s[k].status, k).toBe("ok");
  });

  it("the same pool is never double-counted across providers", () => {
    const v = both([{ liquidityUsd: 100000, volume24hUsd: 10000 }]);
    expect(v.liquidity.value).toBe(100000);
    expect(v.volume24h.value).toBe(10000);
    expect(v.pairs).toHaveLength(1);
  });

  it("an incomplete subset is reported honestly: measured, corroborated and excluded pools are disclosed", () => {
    const v = both([{ liquidityUsd: 300000 }, { liquidityUsd: 20000 }, { liquidityUsd: 10000 }], { 1: { volume24hUsd: null }, 2: { volume24hUsd: 900000 } });
    expect(v.volumeSubset!.excluded.map(e => e.pairAddress)).toEqual(["pool-1", "pool-2"]);
    expect(v.volume24h.reason).toBe("24h volume validated on 1 of 3 corroborated pools holding 90.9% of corroborated reserves; 2 pool(s) excluded for this metric only");
    const evidence = signals(v).activity.evidence;
    expect(evidence).toContainEqual({ label: "Pools measured", value: "1 of 3 corroborated pools" });
    expect(evidence.find(e => e.label === "Excluded for this metric")?.value).toContain("pool-1");
  });

  it("one bad pool cannot poison unrelated valid pools' metrics", () => {
    const v = both([{ liquidityUsd: 500000 }, { liquidityUsd: 300000 }, { liquidityUsd: 5000 }],
      { 2: { volume24hUsd: 5e7, sells24h: 1e6, priceChange24h: -91, pairCreatedAt: NOW + 86400000 } });
    const s = signals(v);
    expect(Object.values(s).filter(x => x !== s.ratio).every(x => x.status === "ok")).toBe(true);
    expect(v.volumeSubset!.poolsMeasured).toBe(2);
    expect(v.activitySubset!.poolsMeasured).toBe(2);
  });
});

describe("24h return: same-pool corroboration, depth majority, unchanged tolerance", () => {
  it("a thin outlier pool (stale prior price) no longer blocks a return the deep pools agree on", () => {
    const v = both([{ liquidityUsd: 6_800_000, priceChange24h: 1.1 }, { liquidityUsd: 175_000, priceChange24h: 1.6 }, { liquidityUsd: 900, priceChange24h: -91 }]);
    expect(v.change24h.status).toBe("validated");
    expect(v.change24h.value).toBeCloseTo(1.1, 6);
    expect(v.change24hSubset).toMatchObject({ poolsMeasured: 2, poolsCorroborated: 3, excluded: [{ pairAddress: "pool-2", reason: "Same-pool return is an outlier to the depth-weighted return" }] });
    expect(signals(v).movement.evidence).toContainEqual({ label: "Measurement", value: "Depth-weighted same-pool return corroborated across providers" });
  });
  it("providers disagreeing on the SAME pool's return never validate", () => {
    const v = both([{ priceChange24h: 2 }], { 0: { priceChange24h: 2 } }, { 0: { priceChange24h: 30 } });
    expect(v.change24h.status).not.toBe("validated");
  });
  it("weighted median is the depth-majority value", () => {
    expect(weightedMedian([{ value: 1, weight: 1 }, { value: 5, weight: 10 }, { value: 9, weight: 1 }])).toBe(5);
    expect(weightedMedian([])).toBeNull();
  });
});

describe("by-address pool lookups corroborate pools but never vote on price", () => {
  const listed = [row({ pairAddress: "pool-x", liquidityUsd: 2_000_000, volume24hUsd: 500_000 }), row({ pairAddress: "pool-y", liquidityUsd: 800_000, volume24hUsd: 100_000 })];
  it("disjoint provider lists (the USDC shape) become corroborated through lookups", () => {
    const dex = snap("dexscreener", listed), gecko = snap("geckoterminal", [row({ pairAddress: "spam-z", liquidityUsd: 9.4e9, volume24hUsd: 100_000 })]);
    const before = validateMarket(MINT, [dex, gecko], [], NOW, 2e6);
    expect(before.price.status).toBe("validated");
    expect(before.liquidity.status).toBe("unavailable");
    const after = validateMarket(MINT, [dex, { ...gecko, lookups: listed.map(o => ({ ...o, provider: "geckoterminal" })) }], [], NOW, 2e6);
    expect(after.price.value).toBe(before.price.value);
    expect(after.liquidity.value).toBe(2_800_000); // the unmatched $9.4B single-provider pool is never counted
    expect(after.pairs.map(p => p.pairAddress)).toEqual(["pool-x", "pool-y"]);
  });
  it("a lookup row whose price disagrees with that provider's consensus is rejected, without creating a conflict", () => {
    const gecko = snap("geckoterminal", [listed[0]], { lookups: [{ ...listed[1], provider: "geckoterminal", priceUsd: 1638 }] });
    const v = validateMarket(MINT, [snap("dexscreener", listed), gecko], [], NOW, 2e6);
    expect(v.price.status).toBe("validated");
    expect(v.price.value).toBe(1);
    const rejected = v.providers.find(p => p.provider === "geckoterminal")!.observations.find(o => o.lookup);
    expect(rejected).toMatchObject({ accepted: false, rejection: "Looked-up pool price disagrees with this provider's own consensus" });
    expect(v.pairs.map(p => p.pairAddress)).toEqual(["pool-x"]);
  });
  it("single-source price stays blocked: lookups alone cannot make a second price opinion", () => {
    const v = validateMarket(MINT, [snap("dexscreener", listed), snap("geckoterminal", [], { lookups: listed.map(o => ({ ...o, provider: "geckoterminal" })) })], [], NOW, 2e6);
    expect(v.price.status).toBe("single_source");
    expect(v.price.value).toBeNull();
    expect(v.liquidity.value).toBeNull();
    expect(v.pairs).toHaveLength(0);
  });
});

describe("price safety is unchanged", () => {
  it("the historical JUP $1,638 corruption remains blocked, even with the corrupt pools offered as lookups", () => {
    const dex = normalizeDexScreener(captured.dex, captured.mint, NOW);
    expect(dex.observations.filter(o => (o.priceUsd ?? 0) > 1000)).toHaveLength(4);
    const token = normalizeGeckoToken(captured.gecko.data, NOW, "https://fixture.invalid");
    const gt: ProviderSnapshot = { provider: "geckoterminal", mint: captured.mint, available: true, fetchedAt: NOW, observations: [], token, errors: [],
      lookups: dex.observations.map(o => ({ ...o, provider: "geckoterminal" })) };
    const v = validateMarket(captured.mint, [dex, gt], [], NOW, 6861486518.571356);
    expect(v.status).toBe("conflict");
    expect(v.price.value).toBeNull();
    expect(v.marketCap.value).toBeNull();
    expect(v.change24h.value).toBeNull();
    expect(v.liquidity.value).toBeNull();
    expect(v.volume24h.value).toBeNull();
    expect(v.pairs).toHaveLength(0);
    const s = signals(v);
    expect(Object.values(s).every(x => x.status === "unavailable")).toBe(true);
  });
  it("a fresh contradictory history close still blocks every market metric and clears subsets", () => {
    const v = both([{}, {}]);
    const blocked = withHistory({ ...v, historyPool: { pairAddress: "pool-0", dexId: "dex" } }, { available: true, points: [{ t: NOW, p: 1638 }], pool: "pool-0",
      mint: MINT, side: "base", fetchedAt: NOW, sourceUrl: "https://fixture.invalid" }, NOW);
    expect(blocked.price.value).toBeNull();
    expect([blocked.volumeSubset, blocked.activitySubset, blocked.change24hSubset]).toEqual([null, null, null]);
    expect(Object.values(signals(blocked)).every(x => x.status === "unavailable")).toBe(true);
  });
  it("market interpretation version is unchanged and Signal 14 is untouched", () => {
    expect(MARKET_ALGORITHM_VERSION).toBe("market-integrity-v2.6");
    const report = buildRiskReport(makeInput({ rugCheck: cleanRugCheck() }), { overview: {} as never, sources: [], elapsedMs: 0 });
    expect(report.signals).toHaveLength(14);
    expect(report.totalWeight).toBe(152);
    expect(report.signals.find(s => s.id === "rug-security")).toMatchObject({ maxPoints: 0, points: 0 });
  });
});
