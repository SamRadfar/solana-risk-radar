import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("server-only", () => ({}));
import captured from "./fixtures/jup-2026-09-27.json";
import { normalizeDexScreener } from "../providers/dexscreener";
import { normalizeGeckoPools, normalizeGeckoToken } from "../providers/gecko-market";
import { providerConsensus } from "./consensus";
import { validateMarket, withHistory, compareMetric } from "./validation";
import { normalizeHistory } from "../providers/geckoterminal";
import { spotPrice, marketCap, fullyDilutedValuation, priceChange24h, contextualQuote, marketEvidenceFresh } from "./access";
import { reportCacheKey, historyCacheKey, MARKET_ALGORITHM_VERSION, agrees, PRICE_AGREEMENT_TOLERANCE } from "./policy";
import { priceVolatilityRule } from "../risk-engine/rules/market";
import { makeInput } from "../risk-engine/test-fixtures";
import { buildRiskReport } from "../risk-engine/engine";
import { getCached, setCached, clearCache } from "../cache";
import type { PoolObservation, ProviderSnapshot, MarketData } from "./types";

const NOW = Date.parse(captured.capturedAt);
beforeEach(clearCache);
const MINT = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const OTHER = captured.mint;
const POOL = captured.dex.pairs[0].pairAddress;
function row(overrides: Partial<PoolObservation> = {}): PoolObservation {
  return { provider: "a", chain: "solana", dexId: "dex", pairAddress: POOL, requestedMint: MINT,
    baseAddress: MINT, baseSymbol: "SOL", quoteAddress: USDC, quoteSymbol: "USDC", side: "base", counterMint: USDC,
    trustedCounterMint: true, priceNative: 1, requestedNativeRatio: 1, reportedPriceUsd: 1, priceUsd: 1,
    liquidityUsd: 100000, volume24hUsd: 10000, reportedChange24h: 2, priceChange24h: 2, buys24h: 100, sells24h: 100,
    pairCreatedAt: NOW-86400000, marketCap: 1000000, fdv: 2000000, fetchedAt: NOW, providerUpdatedAt: null,
    sourceUrl: "https://fixture.invalid", identityError: null, info: { imageUrl: null, websites: [], socials: [] }, ...overrides };
}
function snap(provider = "a", observations = [row()], overrides: Partial<ProviderSnapshot> = {}): ProviderSnapshot {
  return { provider, mint: MINT, available: true, fetchedAt: NOW, observations: observations.map(o => ({ ...o, provider })), token: null, errors: [], ...overrides };
}
const run = (a = snap(), b = snap("b")) => validateMarket(MINT, [a,b], [], NOW, 2000000);
const market = (v = run()): MarketData => ({ available: true, pairs: v.pairs, validation: v, name: null, symbol: null, imageUrl: null, websites: [], socials: [] });

describe("trader availability without invented agreement", () => {
  it.each(["HTTP 429", "timeout", "No pools"])("%s leaves one usable provider single-source", error => {
    const v = run(snap(), snap("b", [], { available: false, errors: [error] }));
    expect(v.status).toBe("single_source");
    expect(contextualQuote(market(v))).toEqual({ priceUsd: 1, provider: "a", fetchedAt: NOW });
    expect(spotPrice(market(v))).toBeNull();
  });
  it("two agreeing providers survive a third outage with medium confidence", () => {
    const v = validateMarket(MINT, [snap(), snap("b"), snap("c", [], { available: false, errors: ["HTTP 429"] })], [], NOW, 2e6);
    expect(v.status).toBe("validated"); expect(v.confidence).toBe("medium");
    expect(v.price.value).toBe(1); expect(contextualQuote(market(v))).toBeNull();
  });
  it("a failed token endpoint does not poison two agreeing pool opinions", () => {
    const v = run(snap(), snap("b", [row()], { errors: ["Token endpoint timeout"] }));
    expect(v.status).toBe("validated"); expect(v.confidence).toBe("medium");
  });
  it("cap disagreement and unavailable history leave spot usable", () => {
    const v = run(snap(), snap("geckoterminal", [row({ marketCap: 1.5e6 })]));
    expect(v.marketCap.status).toBe("conflict"); expect(v.price.status).toBe("validated");
    const checked = withHistory(v, { available: false, points: [], mint: MINT, pool: POOL,
      side: "base", fetchedAt: NOW, sourceUrl: "https://fixture.invalid", error: "HTTP 429" }, NOW);
    expect(checked.status).toBe("validated"); expect(checked.historyCheck.status).toBe("unavailable");
  });
  it.each([1.049, 1.051])("independent gap %s respects the unchanged 5 percent boundary", priceUsd => {
    const v = run(snap(), snap("b", [row({ priceUsd })]));
    expect(v.status).toBe(priceUsd < 1.05 ? "validated" : "conflict");
  });
  it("no-volume quotes are unavailable evidence; missing activity is not invented zero", () => {
    const v = run(snap("a", [row({ volume24hUsd: 0, priceUsd: 5000 })]));
    expect(v.status).toBe("single_source");
    expect(run(snap("a", [row({ volume24hUsd: null, priceUsd: 5000 })])).status).toBe("conflict");
  });
  it("self-consistency never counts as independent corroboration", () => {
    const a = snap("a", [row({ priceUsd: 5000, reportedCounterPriceUsd: 5000 })]);
    expect(providerConsensus(a, [], NOW).status).toBe("usable");
    expect(run(a).status).toBe("conflict");
  });
  it("measured zero volume survives independent spot confirmation, but inconsistent reserves cannot", () => {
    const snapshots = ["a", "b"].map(provider => snap(provider, [row({ volume24hUsd: 0 })], {
      token: { provider, mint: MINT, priceUsd: 1, marketCap: null, fetchedAt: NOW, sourceUrl: "https://fixture.invalid/spot" }
    }));
    const v = validateMarket(MINT, snapshots, [], NOW, 2e6);
    expect(v.status).toBe("validated"); expect(v.volume24h.value).toBe(0); expect(v.liquidity.value).toBe(100000);
    snapshots[0].observations[0].reportedCounterPriceUsd = 5000;
    const bad = validateMarket(MINT, snapshots, [], NOW, 2e6);
    expect(bad.status).toBe("validated"); expect(bad.liquidity.value).toBeNull();
  });
  it("fresh conflict replaces a previously validated cache entry; expired evidence is not reused", () => {
    const key = reportCacheKey(MINT), valid = run();
    setCached(key, valid);
    expect(marketEvidenceFresh(valid, NOW + 90001)).toBe(false);
    const conflict = run(snap(), snap("b", [row({ priceUsd: 5000 })]));
    setCached(key, conflict);
    expect(getCached<typeof conflict>(key)!.price.value).toBeNull();
    expect(contextualQuote(market(conflict))).toBeNull();
  });
  it("single-source UI quote never enters price-dependent rules or overview", () => {
    const input = makeInput(); input.marketData = market(run(snap(), snap("b", [], { available: false })));
    const overview = { mint:MINT,name:null,symbol:null,decimals:9,supply:"1",supplyUi:2e6,supplyIsMeaningful:true,priceUsd:5000,marketCapUsd:5e9,imageUrl:null,tokenProgram:"spl-token",metadataSource:"none",websites:[],socials:[] };
    const report = buildRiskReport(input, { overview, sources: [], elapsedMs: 0 });
    expect(report.market.contextualQuote?.priceUsd).toBe(1);
    expect(report.market.confidence).toBe("low"); expect(report.overview.priceUsd).toBeNull();
    expect(report.market.priceUsd).toBeNull(); expect(report.market.marketCapUsd).toBeNull();
    expect(report.signals.filter(s=>["Liquidity","Market Activity"].includes(s.category)).every(s=>s.status==="unavailable"&&s.points===0)).toBe(true);
  });
});

describe("two-level consensus (replaces pool-weight majority trust)", () => {
  it("A/B: captured JUP has collectively dominant wrong weights without an individual cap trigger, but never validates them", () => {
    const pairs = captured.dex.pairs;
    const oldWeights = pairs.map(p => Math.sqrt(p.liquidity.usd) * (1+Math.log10(1+p.volume.h24)/12) *
      (["USDC","USDT","SOL","WSOL","USDE","PYUSD"].includes(p.quoteToken.symbol) ? 1 : .75) * (p.txns.h24.buys+p.txns.h24.sells>0 ? 1 : .4));
    const total = oldWeights.reduce((a,b)=>a+b,0);
    expect(pairs.filter(p=>Number(p.priceUsd)>1000)).toHaveLength(4);
    expect(pairs.filter(p=>Number(p.priceUsd)<1)).toHaveLength(26);
    expect(oldWeights.filter((_,i)=>Number(pairs[i].priceUsd)>1000).reduce((a,b)=>a+b,0)/total).toBeCloseTo(.632863,5);
    expect(oldWeights.every(w=>w<.9*(total-w))).toBe(true);
    const dex = normalizeDexScreener(captured.dex, captured.mint, NOW);
    const gt: ProviderSnapshot = { provider:"geckoterminal", mint:captured.mint, available:true, fetchedAt:NOW, observations:[],
      token:normalizeGeckoToken(captured.gecko.data,NOW,"https://fixture.invalid"), errors:[] };
    const unresolved = validateMarket(captured.mint,[dex,gt],[],NOW,6861486518.571356);
    expect(unresolved.status).toBe("conflict");
    expect(unresolved.price.value).toBeNull();
    const refs = [captured.gecko_met.data,captured.gecko_jto.data].map(t=>normalizeGeckoToken(t,NOW,"https://fixture.invalid")!);
    const checked = validateMarket(captured.mint,[dex,gt],refs,NOW,6861486518.571356);
    expect(checked.price.value === null || checked.price.value < 1).toBe(true);
    expect(checked.providers.find(p=>p.provider==="dexscreener")!.observations.filter(o=>o.nativeCheck.status==="conflict")).toHaveLength(4);
    expect(checked.change24h.value).toBeNull();
  });
  it("C/Q: ten pools sharing a quote remain one group and one independent provider", () => {
    const a=snap("a",Array.from({length:10},(_,i)=>row({pairAddress:"pool-"+i})));
    const opinion=providerConsensus(a,[],NOW);
    expect(opinion.groups).toHaveLength(1);
    expect(opinion.observations.reduce((n,o)=>n+o.weight,0)).toBeCloseTo(1);
    const v=validateMarket(MINT,[a],[],NOW,2000000);
    expect(v.status).toBe("single_source"); expect(v.confidence).toBe("low"); expect(v.price.value).toBeNull();
    expect(run(a,snap("b",[row({priceUsd:5000})])).status).toBe("conflict");
  });
  it.each([.0001,5000])("minority incompatible cluster at %s cannot be discarded by votes or depth", priceUsd => {
    const a=snap("a",[row(),row({pairAddress:"bad",priceUsd,liquidityUsd:1e15})]);
    expect(run(a).status).toBe("conflict");
  });
  it("D: coherently inflating price, cap and liquidity does not self-validate",()=>{
    const a=snap("a",[row({priceUsd:5000,marketCap:5e9,liquidityUsd:5e8})]);
    const v=run(a); expect(v.status).toBe("conflict"); expect(v.marketCap.value).toBeNull(); expect(v.fdv.value).toBeNull();
  });
  it("E: native USD contradiction rejects the row with its provenance",()=>{
    const p=providerConsensus(snap("a",[row({priceUsd:5000})]),[{provider:"b",mint:USDC,priceUsd:1,marketCap:null,fetchedAt:NOW,sourceUrl:"https://fixture.invalid"}],NOW);
    expect(p.observations[0].accepted).toBe(false); expect(p.observations[0].nativeCheck.expectedPriceUsd).toBe(1);
    expect(p.observations[0].rejection).toContain("Native ratio");
  });
  it("conflicting counter-price references cannot manufacture native consistency",()=>{
    const refs=[{provider:"b",mint:USDC,priceUsd:.1,marketCap:null,fetchedAt:NOW,sourceUrl:"https://fixture.invalid"},
      {provider:"c",mint:USDC,priceUsd:1.9,marketCap:null,fetchedAt:NOW,sourceUrl:"https://fixture.invalid"}];
    const p=providerConsensus(snap(),refs,NOW);
    expect(p.observations[0].nativeCheck.status).toBe("unavailable");
    expect(p.observations[0].nativeCheck.expectedPriceUsd).toBeNull();
  });
  it("G: independent agreement establishes price and corroborated metrics",()=>{
    const v=run(snap(),snap("b",[row({priceUsd:1.01,marketCap:1010000})]));
    expect(v.status).toBe("validated"); expect(v.price.value).toBeCloseTo(1.005);
    expect(v.liquidity.value).toBe(100000); expect(v.volume24h.value).toBe(10000);
    expect(v.pairs).toHaveLength(1);
  });
  it("H: massive provider conflict has no winner",()=>{
    const v=run(snap(),snap("b",[row({priceUsd:5000,liquidityUsd:1e20})]));
    expect(v.status).toBe("conflict"); expect(v.price.value).toBeNull(); expect(v.confidence).toBe("none");
    expect(v.price.sources.map(s=>s.value)).toEqual([1,5000]);
  });
  it("I: outage is single-source, never validation or a spurious conflict",()=>{
    const v=run(snap(),snap("b",[],{available:false,errors:["timeout"]}));
    expect(v.status).toBe("single_source"); expect(v.price.sources[0].value).toBe(1); expect(v.price.value).toBeNull();
  });
  it.each(["marketCap","fdv","change24h","liquidity","volume24h"] as const)("J/K: %s withheld when price is unresolved", key=>{
    const v=run(snap(),snap("b",[row({priceUsd:5000})])); expect(v[key].value).toBeNull();
  });
  it("cap and FDV have distinct supply provenance",()=>{
    const m=market(); expect(marketCap(m)).toBe(1000000); expect(fullyDilutedValuation(m,2000000)).toBe(2000000);
    expect(m.validation!.marketCap.sources).toHaveLength(2);
    const v=run(snap("a",[row({marketCap:null})]),snap("b",[row({marketCap:null})]));
    expect(v.marketCap.value).toBeNull(); expect(v.fdv.value).toBe(2000000);
  });
  it("one cap provider and impossible circulating supply are withheld",()=>{
    expect(run(snap(),snap("b",[row({marketCap:null})])).marketCap.status).toBe("single_source");
    expect(run(snap("a",[row({marketCap:3e6})]),snap("b",[row({marketCap:3e6})])).marketCap.status).toBe("conflict");
  });
  it("L: display and risk signal consume exactly the same validated extreme return",()=>{
    const v=run(snap("a",[row({priceChange24h:10000})]),snap("b",[row({priceChange24h:10000})]));
    const input=makeInput(); input.marketData=market(v);
    const change=priceChange24h(input.marketData)!;
    expect(change).toBe(10000);
    const signal=priceVolatilityRule(input);
    expect(signal.observedValue).toBe("+"+change.toFixed(2)+"% in 24h"); expect(signal.severity).toBe("critical");
  });
  it("spot agreement cannot validate contradictory 24h returns",()=>{
    const v=run(snap(),snap("b",[row({priceChange24h:400000})]));
    expect(v.price.status).toBe("validated"); expect(v.change24h.status).toBe("conflict");
    const input=makeInput(); input.marketData=market(v); expect(priceVolatilityRule(input).status).toBe("unavailable");
  });
  it("N: fresh contradictory history flows upward and invalidates all derived metrics",()=>{
    const v=run(snap(),snap("geckoterminal"));
    const h={available:true,points:[{t:NOW,p:5000}],mint:MINT,pool:POOL,side:"quote" as const,fetchedAt:NOW,sourceUrl:"https://fixture.invalid"};
    const checked=withHistory(v,h,NOW);
    expect(checked.status).toBe("conflict"); expect(checked.history?.points).toHaveLength(1);
    expect(checked.price.value).toBeNull(); expect(checked.fdv.value).toBeNull(); expect(checked.historyCheck.status).toBe("conflict");
    expect(withHistory(v,{...h,points:[{t:NOW-3600000,p:5000}]},NOW).status).toBe("validated");
  });
  it("P: pool/provider permutations are stable and duplicates cannot add confidence",()=>{
    const rows=[row(),row({pairAddress:"pool-2"})], a=snap("a",rows), b=snap("b",rows);
    expect(run(a,b)).toEqual(run(snap("a",[...rows].reverse()),snap("b",[...rows].reverse())));
    expect(validateMarket(MINT,[a,b],[],NOW,2e6)).toEqual(validateMarket(MINT,[b,a],[],NOW,2e6));
    const p=providerConsensus(snap("a",[row(),row()]),[],NOW);
    expect(p.observations.every(o=>!o.accepted && o.rejection?.includes("Duplicate"))).toBe(true);
    expect(validateMarket(MINT,[a,a],[],NOW,2e6).status).toBe("conflict");
  });
  it("R: stale observations and old schema cannot provide a publishable price",()=>{
    expect(run(snap("a",[row({fetchedAt:NOW-100000})])).status).toBe("single_source");
    const m=market(); m.validation!.version="old"; expect(spotPrice(m)).toBeNull();
    expect(run().version).toBe(MARKET_ALGORITHM_VERSION);
    setCached(MINT,{old:true}); expect(getCached(reportCacheKey(MINT))).toBeNull();
    expect(reportCacheKey(MINT)).toContain(MARKET_ALGORITHM_VERSION); expect(historyCacheKey(MINT,POOL)).toContain(MARKET_ALGORITHM_VERSION);
  });
  it("agreement boundary is symmetric and does not round away a conflict",()=>{
    expect(agrees(1,1+PRICE_AGREEMENT_TOLERANCE)).toBe(true);
    expect(agrees(1+PRICE_AGREEMENT_TOLERANCE,1)).toBe(true);
    expect(agrees(1,1+PRICE_AGREEMENT_TOLERANCE+1e-6)).toBe(false);
  });
  it.each([null,0,-1,Infinity,NaN])("unusable price %s rejected with reasons", priceUsd=>{
    const p=providerConsensus(snap("a",[row({priceUsd})]),[],NOW); expect(p.status).toBe("unavailable"); expect(p.observations[0].rejection).toBeTruthy();
  });
  it("dust does not establish an incompatible cluster",()=>{
    const v=run(snap("a",[row(),row({pairAddress:"dust",liquidityUsd:1,priceUsd:5000})]));
    expect(v.status).toBe("validated"); expect(v.providers[0].observations.find(o=>o.pairAddress==="dust")!.accepted).toBe(false);
  });
  it("depth inflation cannot leak through otherwise validated spot",()=>{
    const v=run(snap("a",[row({liquidityUsd:1e10})]),snap("b"));
    expect(v.price.status).toBe("validated"); expect(v.liquidity.value).toBeNull();
  });
  it("missing pool activity stays null and cannot be counted as zero",()=>{
    const v=run(snap("a",[row({volume24hUsd:null,buys24h:null})]),snap("b"));
    expect(v.price.status).toBe("validated");
    expect(v.pairs[0].volume24hUsd).toBeNull(); expect(v.pairs[0].buys24h).toBeNull();
    expect(v.volume24h.status).toBe("unavailable"); expect(v.activity.value).toBeNull();
  });
  it("unavailable data is never a measured zero",()=>{
    const v=validateMarket(MINT,[],[],NOW,null);
    expect(v.status).toBe("unavailable"); expect(v.price.value).toBeNull(); expect(v.liquidity.value).toBeNull();
    expect(compareMetric([{provider:"a",value:null,fetchedAt:NOW}]).status).toBe("unavailable");
  });
  it("conflict removes market rules from scoring denominator without altering other signals",()=>{
    const input=makeInput(); input.marketData=market(run(snap(),snap("b",[row({priceUsd:5000})])));
    const overview={mint:MINT,name:null,symbol:null,decimals:9,supply:"1",supplyUi:2e6,supplyIsMeaningful:true,priceUsd:5000,marketCapUsd:5e9,imageUrl:null,tokenProgram:"spl-token",metadataSource:"none",websites:[],socials:[]};
    const r=buildRiskReport(input,{overview,sources:[],elapsedMs:0});
    expect(r.overview.priceUsd).toBeNull(); expect(r.market.priceUsd).toBeNull();
    const unmeasured=r.signals.filter(s=>["Liquidity","Market Activity"].includes(s.category));
    expect(unmeasured.every(s=>s.status==="unavailable" && s.points===0)).toBe(true);
    expect(r.availableWeight).toBe(r.signals.filter(s=>s.status==="ok").reduce((n,s)=>n+s.maxPoints,0));
    expect(r.signals.find(s=>s.id==="mint-authority")!.status).toBe("ok");
  });
});

describe("provider identity and orientation",()=>{
  const raw=(overrides:Record<string,unknown>={})=>({chainId:"solana",dexId:"test",pairAddress:POOL,
    baseToken:{address:MINT,symbol:"SOL"},quoteToken:{address:USDC,symbol:"USDC"},priceUsd:"100",priceNative:"100",
    liquidity:{usd:10000},volume:{h24:1000},priceChange:{h24:10},txns:{h24:{buys:5,sells:10}},marketCap:1e9,...overrides});
  it("DS quote side derives USD from a proven ratio, never inherits base cap/change",()=>{
    const o=normalizeDexScreener({pairs:[raw()]},USDC,NOW).observations[0];
    expect(o.side).toBe("quote");expect(o.priceUsd).toBe(1);expect(o.requestedNativeRatio).toBe(.01);
    expect(o.priceChange24h).toBeNull();expect(o.marketCap).toBeNull();expect(o.buys24h).toBe(10);
  });
  it("F: opposite DS/GT orientations normalize the requested JUP mint",()=>{
    const gt=normalizeGeckoPools({data:[captured.gecko_bad_pool.data]},captured.mint,NOW)[0];
    expect(gt.side).toBe("quote"); expect(gt.priceUsd).toBeGreaterThan(0); expect(gt.priceUsd).toBeLessThan(1);
    const base=normalizeDexScreener({pairs:[raw({baseToken:{address:captured.mint},quoteToken:{address:gt.baseAddress},priceUsd:String(gt.priceUsd),priceNative:String(gt.requestedNativeRatio)})]},captured.mint,NOW).observations[0];
    expect(base.side).toBe("base");expect(base.priceUsd).toBeCloseTo(gt.priceUsd!);
    expect(gt.priceChange24h).toBeNull();
  });
  it("O: ticker spoofing cannot confer trusted-quote identity",()=>{
    const o=normalizeDexScreener({pairs:[raw({quoteToken:{address:OTHER,symbol:"USDC"}})]},MINT,NOW).observations[0];
    expect(o.trustedCounterMint).toBe(false);
  });
  it.each([{chainId:"ethereum"},{baseToken:{address:OTHER},quoteToken:{address:USDC}},{pairAddress:"not-address"}])("wrong chain/mint/pool is rejected: %j",override=>{
    const ds=normalizeDexScreener({pairs:[raw(override)]},MINT,NOW);
    expect(providerConsensus(ds,[],NOW).observations[0].accepted).toBe(false);
  });
  it("malformed payload and absent quote ratio cannot manufacture price",()=>{
    expect(normalizeDexScreener({},MINT,NOW).available).toBe(false);
    expect(normalizeDexScreener({pairs:[raw({priceNative:null})]},USDC,NOW).observations[0].priceUsd).toBeNull();
  });
  it("M: quote-side USD history is selected by mint, with duplicate and foreign candles rejected",()=>{
    const body={meta:{base:{address:MINT},quote:{address:USDC}},data:{attributes:{ohlcv_list:Array.from({length:6},(_,i)=>[(NOW-i*300000)/1000,0,0,0,1])}}};
    const h=normalizeHistory(body,USDC,POOL,NOW,"https://fixture.invalid?token="+USDC);
    expect(h.available).toBe(true);expect(h.side).toBe("quote");expect(h.points.at(-1)!.p).toBe(1);
    expect(normalizeHistory(body,OTHER,POOL,NOW,"").available).toBe(false);
    body.data.attributes.ohlcv_list.push([NOW/1000,0,0,0,2]);
    expect(normalizeHistory(body,USDC,POOL,NOW,"").available).toBe(false);
  });
});
