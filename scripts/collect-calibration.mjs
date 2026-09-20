/**
 * Calibration data collector (development aid, not part of the build).
 *
 * Pulls a spread of real Solana tokens — established, stablecoin, meme,
 * recently launched, low liquidity — analyses each through the live API, and
 * writes the raw category/signal breakdown to a JSON file.
 *
 * Scoring changes are then calibrated against that captured snapshot rather
 * than against intuition, and the snapshot can be replayed offline while
 * iterating on the aggregation.
 *
 * Usage: node scripts/collect-calibration.mjs [baseUrl]
 */

import { writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = "calibration-data.json";
const PACING_MS = 2500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Known tokens spanning the risk spectrum. */
const KNOWN = [
  ["USDC", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "stablecoin"],
  ["USDT", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", "stablecoin"],
  ["PYUSD", "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", "stablecoin-t2022"],
  ["Wrapped SOL", "So11111111111111111111111111111111111111112", "established"],
  ["JitoSOL", "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", "established-lst"],
  ["JUP", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", "established"],
  ["BONK", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", "meme-established"],
  ["WIF", "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", "meme-established"],
  ["PENGU", "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv", "meme-established"],
  ["TRUMP", "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN", "concentrated"],
];

/** Recently launched tokens, discovered live so the sample is never stale. */
async function discoverRecent(limit = 8) {
  const found = [];
  try {
    const res = await fetch("https://api.dexscreener.com/token-profiles/latest/v1");
    const profiles = await res.json();
    for (const profile of profiles) {
      if (profile.chainId !== "solana" || !profile.tokenAddress) continue;
      if (found.some((f) => f[1] === profile.tokenAddress)) continue;
      found.push([`recent:${profile.tokenAddress.slice(0, 6)}`, profile.tokenAddress, "recent"]);
      if (found.length >= limit) break;
    }
  } catch (error) {
    console.log("  (could not discover recent tokens:", error.message, ")");
  }
  return found;
}

async function analyze(address) {
  const res = await fetch(`${BASE}/api/analyze?address=${encodeURIComponent(address)}`);
  return { status: res.status, body: await res.json() };
}

const tokens = [...KNOWN, ...(await discoverRecent())];
console.log(`Collecting ${tokens.length} tokens from ${BASE}\n`);

const collected = [];

for (const [index, [name, address, kind]] of tokens.entries()) {
  if (index > 0) await sleep(PACING_MS);
  try {
    const { status, body } = await analyze(address);
    if (status !== 200) {
      console.log(`  skip ${name.padEnd(18)} HTTP ${status} ${body.error?.slice(0, 70) ?? ""}`);
      continue;
    }

    const record = {
      name,
      kind,
      address,
      symbol: body.overview.symbol,
      score: body.score,
      classification: body.classification,
      coveragePercent: body.coveragePercent,
      categories: body.categories,
      signals: body.signals.map((s) => ({
        id: s.id,
        category: s.category,
        status: s.status,
        severity: s.severity,
        points: s.points,
        maxPoints: s.maxPoints,
        observedValue: s.observedValue,
        evidenceCount: s.evidence.length,
      })),
      distribution: {
        available: body.distribution.available,
        topHolderShare: body.distribution.topHolderShare,
        top10Share: body.distribution.top10Share,
        holderCount: body.distribution.holders.length,
      },
    };
    collected.push(record);

    const cats = body.categories
      .map((c) => `${c.category[0]}${c.percent === null ? "--" : String(c.percent).padStart(3)}`)
      .join(" ");
    console.log(
      `  ${name.padEnd(18)} ${String(body.score ?? "n/a").padStart(3)} ${body.classification.padEnd(22)} cov${String(body.coveragePercent).padStart(4)}%  ${cats}`,
    );
  } catch (error) {
    console.log(`  fail ${name}: ${error.message}`);
  }
}

writeFileSync(OUT, JSON.stringify(collected, null, 2));
console.log(`\nWrote ${collected.length} records to ${OUT}`);
