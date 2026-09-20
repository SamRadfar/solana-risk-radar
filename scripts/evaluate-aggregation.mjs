/**
 * Replays captured calibration data through candidate aggregation functions so
 * scoring changes can be judged against real tokens instead of intuition.
 *
 * Usage: node scripts/evaluate-aggregation.mjs
 * Requires calibration-data.json (see collect-calibration.mjs).
 */

import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync("calibration-data.json", "utf8"));

const CATS = ["Authorities", "Holders", "Liquidity", "Market Activity", "Maturity"];

/** Category ratios 0-1, null when the category had nothing measurable. */
function ratios(record) {
  const out = {};
  for (const cat of CATS) {
    const entry = record.categories.find((c) => c.category === cat);
    out[cat] = entry && entry.maxPoints > 0 ? entry.points / entry.maxPoints : null;
  }
  return out;
}

/** Current production behaviour: flat weighted mean over signal weights. */
function currentScore(record) {
  let points = 0;
  let weight = 0;
  for (const s of record.signals) {
    if (s.status !== "ok") continue;
    points += s.points;
    weight += s.maxPoints;
  }
  return weight > 0 ? Math.round((points / weight) * 100) : null;
}

/** Weighted power mean over CATEGORY ratios. p=1 is the arithmetic mean. */
function categoryPowerMean(record, weights, p) {
  const r = ratios(record);
  let num = 0;
  let den = 0;
  for (const cat of CATS) {
    if (r[cat] === null) continue;
    num += weights[cat] * r[cat] ** p;
    den += weights[cat];
  }
  if (den === 0) return null;
  return Math.round((num / den) ** (1 / p) * 100);
}

const EQUAL = Object.fromEntries(CATS.map((c) => [c, 20]));
const TILTED = {
  Authorities: 25,
  Holders: 22,
  Liquidity: 22,
  Maturity: 16,
  "Market Activity": 15,
};

const CANDIDATES = [
  ["current", (r) => currentScore(r)],
  ["catMean-eq", (r) => categoryPowerMean(r, EQUAL, 1)],
  ["catMean-tilt", (r) => categoryPowerMean(r, TILTED, 1)],
  ["catRMS-eq", (r) => categoryPowerMean(r, EQUAL, 2)],
  ["catRMS-tilt", (r) => categoryPowerMean(r, TILTED, 2)],
  ["catP3-tilt", (r) => categoryPowerMean(r, TILTED, 3)],
];

const header = ["token".padEnd(18), "kind".padEnd(18), ...CANDIDATES.map(([n]) => n.padStart(13))];
console.log(header.join(""));
console.log("-".repeat(header.join("").length));

for (const record of data) {
  const row = [
    record.name.slice(0, 17).padEnd(18),
    record.kind.padEnd(18),
    ...CANDIDATES.map(([, fn]) => String(fn(record) ?? "n/a").padStart(13)),
  ];
  console.log(row.join(""));
}

// How well does each candidate separate "should be risky" from "should be safe"?
console.log("\nSeparation check (higher gap = better discrimination)");
console.log("-".repeat(70));

const RISKY = new Set(["recent"]);
const SAFE = new Set(["established", "established-lst", "meme-established", "stablecoin"]);

for (const [name, fn] of CANDIDATES) {
  const risky = data.filter((r) => RISKY.has(r.kind)).map(fn).filter((v) => v !== null);
  const safe = data.filter((r) => SAFE.has(r.kind)).map(fn).filter((v) => v !== null);
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const minRisky = Math.min(...risky);
  const maxSafe = Math.max(...safe);
  console.log(
    `  ${name.padEnd(14)} risky avg ${avg(risky).toFixed(1).padStart(5)} (min ${String(minRisky).padStart(3)})  ` +
      `safe avg ${avg(safe).toFixed(1).padStart(5)} (max ${String(maxSafe).padStart(3)})  ` +
      `overlap ${minRisky <= maxSafe ? `YES (${maxSafe - minRisky} pts)` : "none"}`,
  );
}
