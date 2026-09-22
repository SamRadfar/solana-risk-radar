/**
 * Live market-data audit.
 *
 * Runs the real analysis endpoint against a fixed token set and prints the
 * consensus diagnostics for each, so a release can be eyeballed against
 * independent references before it ships. Not part of `vitest run`: it needs
 * the network and real prices move.
 *
 * Usage: node scripts/market-audit.mjs [baseUrl]
 */
const BASE = process.argv[2] ?? "http://127.0.0.1:3450";

const TOKENS = [
  ["SOL   ", "So11111111111111111111111111111111111111112"],
  ["USDC  ", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
  ["JUP   ", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"],
  ["BONK  ", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"],
  ["WIF   ", "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"],
  ["PYUSD ", "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"],
  ["PUMP  ", "DqSpieUuFtJqKDuUiLYvBLVR2B8UYErSd2FhtknKpump"],
];

const usd = (v) =>
  v === null || v === undefined ? "—" : v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(4)}`;
const px = (v) => (v === null ? "—" : v >= 1 ? `$${v.toFixed(4)}` : `$${v.toPrecision(4)}`);

let failures = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failures += 1;
  console.log(`      ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
};

for (const [name, mint] of TOKENS) {
  const res = await fetch(`${BASE}/api/analyze?address=${mint}`);
  if (!res.ok) {
    console.log(`\n${name} HTTP ${res.status}`);
    failures += 1;
    continue;
  }
  const r = await res.json();
  const d = r.diagnostics;
  const m = r.market;

  console.log(`\n${name} ${r.overview.symbol ?? "?"} · ${r.overview.name ?? "unnamed"}`);
  console.log(`   price ${px(m.priceUsd)}  conf=${d.confidence}  pools ${d.acceptedPools}/${d.consideredPools} accepted` +
    `  dispersion=${d.dispersion === null ? "—" : (d.dispersion * 100).toFixed(2) + "%"}` +
    `  liq share=${d.liquidityShare === null ? "—" : (d.liquidityShare * 100).toFixed(0) + "%"}`);
  console.log(`   mcap ${usd(m.marketCapUsd)}  fdv ${usd(m.fullyDilutedUsd)}  liq ${usd(m.liquidityUsd)}  vol ${usd(m.volume24hUsd)}  24h ${m.priceChange24hPercent === null ? "—" : m.priceChange24hPercent.toFixed(2) + "%"}`);
  console.log(`   decimals=${r.overview.decimals} supply=${r.overview.supplyUi.toLocaleString()} program=${r.overview.tokenProgram}`);

  const rejected = d.pools.filter((p) => !p.accepted);
  if (rejected.length) {
    const reasons = {};
    for (const p of rejected) reasons[p.rejection] = (reasons[p.rejection] ?? 0) + 1;
    console.log(`   rejected: ${Object.entries(reasons).map(([k, v]) => `${v}x ${k}`).join(" · ")}`);
  }

  // --- invariants that must hold for every token ---
  check(r.overview.mint === mint, "identity is the analysed mint");
  if (m.priceUsd !== null) {
    check(m.priceUsd > 0 && Number.isFinite(m.priceUsd), "price is a usable number");
    const accepted = d.pools.filter((p) => p.accepted);
    const worst = Math.max(...accepted.map((p) => Math.abs(p.priceUsd - m.priceUsd) / m.priceUsd));
    check(worst <= 0.3, "every accepted pool is within tolerance of the consensus", `worst ${(worst * 100).toFixed(1)}%`);
  }
  if (m.marketCapUsd !== null && m.fullyDilutedUsd !== null) {
    check(m.marketCapUsd <= m.fullyDilutedUsd * 1.02, "market cap does not exceed fully diluted value");
  }
  if (m.marketCapUsd !== null && m.priceUsd !== null && r.overview.supplyIsMeaningful) {
    const implied = m.marketCapUsd / m.priceUsd;
    check(implied <= r.overview.supplyUi * 1.02, "implied circulating supply fits inside total supply",
      `${implied.toExponential(2)} vs ${r.overview.supplyUi.toExponential(2)}`);
  }
  if (m.fullyDilutedUsd !== null && m.priceUsd !== null) {
    check(Math.abs(m.fullyDilutedUsd - m.priceUsd * r.overview.supplyUi) / m.fullyDilutedUsd < 1e-6,
      "fully diluted value equals price x on-chain supply");
  }
  check(d.historyPool === null || d.pools.some((p) => p.pairAddress === d.historyPool && p.accepted),
    "4h history pool is one the consensus accepted");

  // 4h chart endpoint must agree with the canonical price
  if (m.poolAddress && m.priceUsd) {
    const h = await fetch(`${BASE}/api/history?mint=${mint}&pool=${m.poolAddress}`).then((x) => x.json());
    if (h.available) {
      const last = h.points[h.points.length - 1].p;
      const gap = Math.abs(last - m.priceUsd) / m.priceUsd;
      check(gap < 0.25, "4h chart ends near the canonical price", `${(gap * 100).toFixed(2)}% apart, ${h.points.length} points`);
    } else {
      console.log(`      --   4h history unavailable: ${h.error}`);
    }
  }
}

console.log(`\n${failures === 0 ? "All live invariants held." : `${failures} live invariant failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
