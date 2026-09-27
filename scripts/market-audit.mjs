/**
 * Live external validity audit. Default: real analysis endpoint.
 * node scripts/market-audit.mjs http://127.0.0.1:3450
 * node scripts/market-audit.mjs --providers-only [--new-mint=<address>]
 * providers-only runs the SAME production service, without RPC/supply/scoring;
 * requires Node >=22.15 (in-memory TypeScript module hooks, no generated code).
 */
import { writeFile } from "node:fs/promises";

const providerOnly = process.argv.includes("--providers-only");
const BASE = process.argv.find(a => /^https?:/.test(a)) ?? "http://127.0.0.1:3450";
const TOKENS = [
  ["SOL", "So11111111111111111111111111111111111111112"],
  ["USDC", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
  ["JUP", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"],
  ["BONK", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"],
  ["WIF", "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"],
  ["PYUSD", "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"],
  ["RAY", "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R"],
  ["JTO", "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL"],
  ["PYTH", "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3"],
  ["SAROS", "SarosY6Vscao718M4A778z4CGtvcwcGef5M9MEH1LGL"],
  ["NEW", "DiLreFZuxDyzUsScrf2aszEEWcHRyvV8p2fXnS5Mpump"],
];
const extra = process.argv.find(a => a.startsWith("--new-mint="))?.split("=")[1];
if (extra) TOKENS.push(["EXTRA", extra]);
const output = process.argv.find(a => a.startsWith("--output="))?.slice(9);
let getMarketData, policy;
if (providerOnly) {
  const { registerHooks, stripTypeScriptTypes } = await import("node:module");
  const { readFileSync, existsSync } = await import("node:fs");
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith(".") && context.parentURL) {
        const url = new URL(specifier, context.parentURL);
        if (!/\.[a-z]+$/i.test(url.pathname) && existsSync(new URL(url.href + ".ts")))
          return { url: url.href + ".ts", shortCircuit: true };
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url.endsWith(".ts")) return { format: "module", source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8")), shortCircuit: true };
      return next(url, context);
    },
  });
  ({ getMarketData } = await import("../src/lib/market/service.ts"));
  policy = await import("../src/lib/market/policy.ts");
}
const distance = (a,b) => Math.min(a,b)>0 ? Math.max(a,b)/Math.min(a,b)-1 : Infinity;
let failures=0, unavailable=0;
const results=[];
const check=(ok,label)=> { if(!ok){ failures++; console.log("  FAIL "+label); } };
for (const [name,mint] of TOKENS) {
  try {
    let d, market, headers, signals;
    if (providerOnly) {
      d=(await getMarketData(mint,null)).validation;
      market={priceUsd:d.price.value,marketCapUsd:d.marketCap.value,fullyDilutedUsd:d.fdv.value,priceChange24hPercent:d.change24h.value};
    } else {
      const response=await fetch(BASE+"/api/analyze?address="+encodeURIComponent(mint),{signal:AbortSignal.timeout(120000)});
      headers={cache:response.headers.get("x-cache"),version:response.headers.get("x-market-version")};
      if(!response.ok) throw Error("Analysis HTTP "+response.status);
      const report=await response.json(); d=report.diagnostics; market=report.market; signals=report.signals;
      check(report.overview.mint===mint,"requested mint identity");
    }
    check(d.version==="market-integrity-v2.5","expected algorithm version");
    if (!d.price || !Array.isArray(d.providers)) throw Error("Old/malformed validation diagnostics");
    console.log("\n"+name+" "+d.status+" price="+(market.priceUsd??"WITHHELD")+" confidence="+d.confidence);
    console.log("  cap="+d.marketCap.status+" fdv="+d.fdv.status+" 24h="+d.change24h.status+" disagreement="+d.price.disagreement);
    for(const p of d.providers) console.log("  "+p.provider+": "+p.status+" price="+p.priceUsd+" candidates="+JSON.stringify(p.candidatePrices)+" errors="+p.errors.join("; "));
    console.log("  "+d.price.reason+"; history="+d.historyCheck.status);
    check(market.priceUsd===d.price.value,"published price equals validated measurement");
    if(d.status!=="validated") {
      check(market.priceUsd===null&&market.marketCapUsd===null&&market.fullyDilutedUsd===null,"unverified/conflicting valuation withheld");
    } else {
      const sources=d.price.sources.filter(s=>s.value!==null);
      check(new Set(sources.map(s=>s.provider)).size>=2,"at least two provider opinions");
      check(!d.providers.some(p=>p.status==="conflict"),"no hidden provider conflict");
      check(sources.every(s=>distance(s.value,market.priceUsd)<=.05+1e-12),"provider values corroborate canonical price");
    }
    check(market.priceChange24hPercent===d.change24h.value,"single 24h display pipeline");
    if(signals) {
      const signal=signals.find(s=>s.id==="price-volatility");
      check(d.change24h.status==="validated" ? signal.status==="ok" && signal.observedValue===(d.change24h.value>=0?"+":"")+d.change24h.value.toFixed(2)+"% in 24h" : signal.status==="unavailable","24h scoring agrees with validation");
    }

    // Fresh external observation, not an arithmetic self-consistency check.
    const refUrl="https://api.geckoterminal.com/api/v2/networks/solana/tokens/"+encodeURIComponent(mint);
    let refResponse=await fetch(refUrl,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(12000)});
    const externalAttempts=[refResponse.status];
    if(refResponse.status===429) {
      console.log("  External service rate-limited; one paced retry in 45 seconds");
      await new Promise(resolve=>setTimeout(resolve,45000));
      refResponse=await fetch(refUrl,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(12000)});
      externalAttempts.push(refResponse.status);
    }
    const refBody=await refResponse.json();
    const token=refBody.data;
    const external=refResponse.ok&&token?.id==="solana_"+mint&&token?.attributes?.address===mint ? Number(token.attributes.price_usd) : null;
    const externalPrice=Number.isFinite(external)&&external>0?external:null;
    const gap=market.priceUsd!==null&&externalPrice!==null?distance(market.priceUsd,externalPrice):null;
    if(externalPrice===null){unavailable++; console.log("  External check UNAVAILABLE (HTTP "+refResponse.status+")");}
    else if(gap!==null){check(gap<=(policy?.PRICE_AGREEMENT_TOLERANCE??.05),"fresh external token price corroborates published price"); console.log("  external="+externalPrice+" gap="+gap);}
    else console.log("  external="+externalPrice+"; canonical withheld, no claim of accuracy");
    results.push({name,mint,at:new Date().toISOString(),mode:providerOnly?"providers-only":"full-analysis",headers,
      contextualQuote:market.contextualQuote??null,
      timing:{providerFetchDifferenceMs:Math.max(...d.providers.map(p=>p.fetchedAt))-Math.min(...d.providers.map(p=>p.fetchedAt)),
        oldestObservationAgeMs:d.evaluatedAt-Math.min(...d.providers.flatMap(p=>p.observations.filter(o=>o.accepted).map(o=>o.fetchedAt)))},
      riskUse:signals?signals.filter(s=>["Liquidity","Market Activity"].includes(s.category)).map(s=>({id:s.id,status:s.status,points:s.points})):null,
      external:{url:refUrl,status:refResponse.status,attempts:externalAttempts,price:externalPrice,gap},validation:d});
  } catch(error) {
    failures++; results.push({name,mint,error:String(error)}); console.log("\n"+name+" ERROR "+String(error));
  }
  // Free-tier pacing: at most six GT calls per token, then forty-five seconds.
  if(name!==TOKENS.at(-1)[0]) await new Promise(resolve=>setTimeout(resolve,45000));
}
const established=results.filter(r=>!['SAROS','NEW','EXTRA'].includes(r.name));
const statuses=Object.fromEntries(['validated','single_source','conflict','unavailable'].map(status=>[status,established.filter(r=>r.validation?.status===status).length/established.length*100]));
const gaps=established.filter(r=>r.validation?.status==='validated'&&r.validation.price.disagreement!==null).map(r=>r.validation.price.disagreement).sort((a,b)=>a-b);
const calibration={establishedCount:established.length,statusPercent:statuses,validatedGapSampleSize:gaps.length,
  medianGap:gaps.length?(gaps[Math.floor((gaps.length-1)/2)]+gaps[Math.floor(gaps.length/2)])/2:null,
  p90Gap:gaps.length?gaps[Math.ceil(gaps.length*.9)-1]:null,maxGap:gaps.at(-1)??null};
console.log('Calibration '+JSON.stringify(calibration));
if(output) await writeFile(output,JSON.stringify({failures,externalUnavailable:unavailable,calibration,results},null,2)+"\n");
console.log("\nAudit completed: "+failures+" failures; "+unavailable+" unavailable external checks. Withheld/conflict states are not accuracy confirmations.");
process.exitCode=failures?1:unavailable?2:0;
