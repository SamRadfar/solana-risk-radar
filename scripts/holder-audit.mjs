/**
 * Live holder-classification audit.
 *
 * Prints the verified control structure of every top holder for a fixed token
 * set, so a release can be checked for over-confident labelling before it
 * ships. Not part of `vitest run`: it needs the network.
 */
const BASE = process.argv[2] ?? "http://127.0.0.1:3460";
const TOKENS = [
  ["JUP  ", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"],
  ["USDC ", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
  ["BONK ", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"],
  ["WIF  ", "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"],
  ["PYUSD", "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"],
  ["NEW  ", "DqSpieUuFtJqKDuUiLYvBLVR2B8UYErSd2FhtknKpump"],
];

let fails = 0;
const check = (ok, label, detail = "") => { if (!ok) fails++; console.log(`     ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`); };
const pct = (v) => (v * 100).toFixed(2) + "%";
const tally = {};

for (const [name, mint] of TOKENS) {
  const r = await fetch(`${BASE}/api/analyze?address=${mint}`).then((x) => x.json());
  const d = r.distribution;
  console.log(`\n${name} — ${d.available ? `${d.holders.length} holders` : "holder data unavailable"}`);
  if (!d.available) { console.log(`   ${d.reason}`); continue; }

  console.log(`   raw top holder ${pct(d.topHolderShare)}   effective liquid ${pct(d.effectiveTopHolderShare)}   verified locked ${pct(d.verifiedLockedShare)}`);
  for (const h of d.holders.slice(0, 6)) {
    for (const a of h.attributes) tally[a] = (tally[a] ?? 0) + 1;
    const ms = h.multisig ? ` (${h.multisig.threshold}/${h.multisig.signers})` : "";
    const agg = h.accountCount > 1 ? `  [${h.accountCount} accounts]` : "";
    const lock = h.lockedShare > 0 ? `  locked ${pct(h.lockedShare)}` : "";
    console.log(`     ${pct(h.share).padStart(7)}  ${h.attributes.join(" · ")}${ms}${agg}${lock}`);
  }

  // invariants
  check(d.holders.every((h) => h.attributes.length > 0), "every holder carries a classification");
  check(d.holders.every((h) => h.lockedShare <= h.share + 1e-9), "locked never exceeds the holding");
  check(d.effectiveTopHolderShare <= d.topHolderShare + 1e-9, "effective liquid never exceeds raw concentration");
  check(d.holders.every((h) => !h.attributes.includes("locked") || h.lockedShare > 0),
    "nothing is called locked without a verified locked amount");
  check(d.holders.every((h) => !h.attributes.includes("lock-program") || h.lockedShare === 0),
    "lock-program custody never counts as locked supply");
  check(d.holders.every((h) => h.attributes.includes("unknown") || h.attributes.some((a) => ["multisig","locked","lock-program","liquidity-pool","exchange","burned"].includes(a))),
    "a holder is either explained or explicitly unknown");
  check(d.holders.every((h) => !h.multisig || (h.multisig.threshold > 0 && h.multisig.threshold <= h.multisig.signers)),
    "any displayed multisig threshold is coherent");
  const owners = d.holders.map((h) => h.owner).filter(Boolean);
  check(new Set(owners).size === owners.length, "each owner appears once", `${owners.length} owners`);
  check(d.holders.every((h) => h.kind !== "pool" || h.attributes.includes("liquidity-pool")),
    "pool vaults are labelled as liquidity, not whales");
}

console.log("\nattribute frequency across the sampled holders:");
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`   ${String(v).padStart(3)}  ${k}`);
console.log(`\n${fails === 0 ? "All holder invariants held." : `${fails} invariant failure(s).`}`);
process.exit(fails === 0 ? 0 : 1);
