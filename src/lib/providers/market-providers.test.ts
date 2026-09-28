import { afterEach, describe, expect, it, vi } from "vitest";
import { getDexScreenerSnapshot } from "./dexscreener";
import { getGeckoSnapshot, getGeckoReferences } from "./gecko-market";
import { getPriceHistory } from "./geckoterminal";
import { getMarketData } from "../market/service";
import { validateMarket } from "../market/validation";
import { marketJson, clearRetainedResponses } from "./market-http";
const MINT="So11111111111111111111111111111111111111112";
const USDC="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
afterEach(()=>{ vi.unstubAllGlobals(); clearRetainedResponses(); });
describe("provider network contracts",()=>{
  it("one bounded retry recovers 429 and deduplicates concurrent reads",async()=>{
    const mock=vi.fn().mockResolvedValueOnce(new Response("{}",{status:429}))
      .mockImplementation(()=>Promise.resolve(new Response('{"ok":true}')));
    vi.stubGlobal("fetch",mock);
    const [a,b]=await Promise.all([marketJson("https://fixture.invalid/retry"),marketJson("https://fixture.invalid/retry")]);
    expect(mock).toHaveBeenCalledTimes(2); expect(a).toBe(b);
    expect(a.error).toBeNull(); expect(a.events[0]).toContain("429");
    await marketJson("https://fixture.invalid/retry");
    expect(mock).toHaveBeenCalledTimes(3); // no retained last-known-valid fallback
  });
  it("honours long Retry-After without hammering or blocking the analysis",async()=>{
    const mock=vi.fn().mockResolvedValue(new Response("{}",{status:429,headers:{"retry-after":"60"}}));
    vi.stubGlobal("fetch",mock);
    const result=await marketJson("https://fixture.invalid/long");
    expect(result.error).toContain("429"); expect(mock).toHaveBeenCalledTimes(1);
  });
  it("timeout retry is bounded and remains missing evidence",async()=>{
    const mock=vi.fn().mockRejectedValue(new DOMException("timeout","TimeoutError"));
    vi.stubGlobal("fetch",mock);
    const result=await marketJson("https://fixture.invalid/timeout");
    expect(result.body).toBeNull(); expect(result.error).toContain("timed out"); expect(mock).toHaveBeenCalledTimes(2);
  });
  it("timeouts never become usable zero-price data",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new DOMException("timeout","TimeoutError")));
    const [a,b]=await Promise.all([getDexScreenerSnapshot(MINT),getGeckoSnapshot(MINT)]);
    expect(a.available).toBe(false);expect(b.available).toBe(false);
    const v=validateMarket(MINT,[a,b],[],Date.now(),1);
    expect(v.status).toBe("unavailable");expect(v.price.value).toBeNull();
  });
  it("whole orchestration gracefully returns unmeasured when both services fail",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("{}",{status:429})));
    const result=await getMarketData(MINT,1);
    expect(result.validation!.status).toBe("unavailable");
    expect(result.validation!.providers.every(p=>p.errors.length>0)).toBe(true);
    expect(result.pairs).toHaveLength(0);
  });
  it("a token endpoint for a different mint cannot become a provider opinion",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({data:{id:"solana_"+USDC,attributes:{address:USDC,price_usd:"1"}}}))));
    const snapshot=await getGeckoSnapshot(MINT);
    expect(snapshot.token).toBeNull();expect(snapshot.available).toBe(false);
  });
  it("counter-reference outage preserves a reason instead of inventing pegs",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("{}",{status:429})));
    const references=await getGeckoReferences([USDC]);
    expect(references.references).toHaveLength(0);expect(references.error).toContain("429");
  });
  it("OHLCV requests the exact quote-side mint in USD and preserves identity",async()=>{
    const now=Date.now();
    const mock=vi.fn().mockResolvedValue(new Response(JSON.stringify({meta:{base:{address:MINT},quote:{address:USDC}},data:{attributes:{ohlcv_list:Array.from({length:6},(_,i)=>[(now-i*300000)/1000,0,0,0,1])}}})));
    vi.stubGlobal("fetch",mock);
    const result=await getPriceHistory(USDC,MINT,now);
    const url=new URL(mock.mock.calls[0][0]);
    expect(url.searchParams.get("token")).toBe(USDC);expect(url.searchParams.get("currency")).toBe("usd");
    expect(result.side).toBe("quote");expect(result.available).toBe(true);expect(result.points.every(p=>p.p===1)).toBe(true);
  });
  it("history HTTP failure does not supply an invented series",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("{}",{status:404})));
    const h=await getPriceHistory(MINT,USDC);
    expect(h.available).toBe(false);expect(h.points).toHaveLength(0);expect(h.error).toContain("404");
  });
});
