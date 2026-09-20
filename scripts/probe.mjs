/**
 * Integration probe: runs the live /api/analyze endpoint against real mainnet
 * tokens and prints a compact summary of each report.
 *
 * Usage: node scripts/probe.mjs [baseUrl]
 *
 * This is a development aid, not part of the build. It hits real networks, so
 * results vary with market conditions — it verifies that the pipeline works
 * end to end, not that any particular score is stable.
 */

const BASE = process.argv[2] ?? "http://localhost:3000";

const TOKENS = [
  ["USDC (stablecoin)", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
  ["USDT (stablecoin)", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"],
  ["PYUSD (Token-2022)", "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"],
  ["Wrapped SOL", "So11111111111111111111111111111111111111112"],
  ["JitoSOL (LST)", "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"],
  ["JUP (established)", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"],
  ["BONK (meme)", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"],
  ["WIF (meme)", "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"],
  ["PENGU (meme)", "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv"],
  ["TRUMP (concentrated)", "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN"],
];

const ERROR_CASES = [
  ["invalid base58 (contains 0)", "0000000000000000000000000000000000000000000"],
  ["too short", "abc"],
  ["empty", ""],
  ["valid key, no account", "11111111111111111111111111111112"],
  ["wallet, not a mint", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"],
  ["token account, not a mint", "5hpfC9VBxVcoW9opCnM2PqR6YWRLBzrBpabJTZnwwNiw"],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Free public RPC endpoints meter the account-scanning methods per second, and
 * each analysis issues several calls. Probing tokens back to back would
 * throttle ourselves and make holder data look broken when it is not.
 */
const PACING_MS = 2500;

async function analyze(address) {
  const started = Date.now();
  const response = await fetch(
    `${BASE}/api/analyze?address=${encodeURIComponent(address)}`,
  );
  const body = await response.json();
  return { status: response.status, body, ms: Date.now() - started };
}

function bar(percent) {
  if (percent === null) return "  n/a";
  const filled = Math.round(percent / 10);
  return `${String(percent).padStart(3)}% ${"█".repeat(filled)}${"·".repeat(10 - filled)}`;
}

console.log(`\nProbing ${BASE}\n${"=".repeat(78)}`);

let failures = 0;

for (const [index, [name, address]] of TOKENS.entries()) {
  if (index > 0) await sleep(PACING_MS);
  try {
    const { status, body, ms } = await analyze(address);

    if (status !== 200) {
      console.log(`\n✗ ${name}\n  HTTP ${status}: ${body.error}`);
      failures += 1;
      continue;
    }

    const { overview, score, classification, coveragePercent, signals, categories, summary } =
      body;
    console.log(
      `\n${name}  (${overview.symbol ?? "?"} · ${overview.name ?? "?"})  ${ms}ms`,
    );
    console.log(
      `  score ${score === null ? "n/a" : String(score).padStart(3)}/100  ${classification}  ` +
        `· coverage ${coveragePercent}%  · ${overview.tokenProgram}  · metadata: ${overview.metadataSource}`,
    );

    for (const category of categories) {
      console.log(`    ${category.category.padEnd(16)} ${bar(category.percent)}`);
    }

    console.log(`    why: ${summary.rationale}`);
    if (summary.topConcerns.length > 0) {
      console.log(
        `    concerns: ${summary.topConcerns
          .map((c, i) => `${i + 1}. ${c.label} ${c.observedValue} [${c.severity}]`)
          .join("  ")}`,
      );
    }

    const flagged = signals.filter((s) => s.status === "ok" && s.severity !== "none");
    const missing = signals.filter((s) => s.status === "unavailable");
    if (flagged.length > 0) {
      console.log(
        `    flagged: ${flagged.map((s) => `${s.label}=${s.severity}(${s.points}p)`).join(", ")}`,
      );
    }
    if (missing.length > 0) {
      console.log(`    unmeasured: ${missing.map((s) => s.label).join(", ")}`);
    }

    // Invariants that must hold for every report, whatever the market does.
    const assertions = [
      [score === null || (score >= 0 && score <= 100), "score within 0-100"],
      [
        signals.every((s) => s.points >= 0 && s.points <= s.maxPoints),
        "every signal's points within its weight",
      ],
      [
        signals.every((s) => s.status !== "unavailable" || s.points === 0),
        "unavailable signals charge no points",
      ],
      [
        signals.every((s) => s.explanation.length > 0 && s.metric.length > 0),
        "every signal explains itself",
      ],
      [new Set(signals.map((s) => s.id)).size === signals.length, "signal ids unique"],
      // Every measured signal must open onto supporting evidence: that is the
      // product's core trust claim.
      [
        signals.every((s) => s.status !== "ok" || s.evidence.length > 0),
        "every measured signal carries evidence",
      ],
      [
        signals.every((s) =>
          s.evidence.every(
            (e) => e.label?.length > 0 && e.value?.length > 0 && (!e.href || e.href.startsWith("https://")),
          ),
        ),
        "evidence items are well-formed with https links only",
      ],
      // The summary must be consistent with the signals it claims to summarise.
      [
        summary.counts.critical +
          summary.counts.high +
          summary.counts.medium +
          summary.counts.low +
          summary.counts.none +
          summary.counts.unavailable ===
          signals.length,
        "severity counts total the signal count",
      ],
      [
        summary.topConcerns.every((c) => {
          const match = signals.find((s) => s.id === c.id);
          return match && match.status === "ok" && match.severity === c.severity;
        }),
        "every listed concern traces back to a measured signal",
      ],
      [
        summary.topConcerns.every((c) => c.severity !== "none"),
        "no clean signal is presented as a concern",
      ],
      [
        typeof summary.rationale === "string" && summary.rationale.trim().endsWith("."),
        "rationale is a complete sentence",
      ],
      [
        categories.every((c) => c.percent === null || (c.percent >= 0 && c.percent <= 100)),
        "category percentages within 0-100",
      ],
      // A single compromised dimension must never on its own reach High.
      [
        score === null ||
          categories.filter((c) => (c.percent ?? 0) >= 100).length >= 2 ||
          score < 60,
        "one maxed category alone does not produce a High verdict",
      ],
    ];
    for (const [ok, label] of assertions) {
      if (!ok) {
        console.log(`    ✗ INVARIANT FAILED: ${label}`);
        failures += 1;
      }
    }
  } catch (error) {
    console.log(`\n✗ ${name}: ${error.message}`);
    failures += 1;
  }
}

console.log(`\n${"=".repeat(78)}\nError handling\n${"=".repeat(78)}`);

for (const [name, address] of ERROR_CASES) {
  try {
    const { status, body } = await analyze(address);
    const ok = status >= 400 && typeof body.error === "string" && body.error.length > 0;
    console.log(`  ${ok ? "✓" : "✗"} ${name.padEnd(30)} HTTP ${status}  ${body.error ?? "(no error message)"}`);
    if (!ok) failures += 1;
  } catch (error) {
    console.log(`  ✗ ${name}: ${error.message}`);
    failures += 1;
  }
}

console.log(`\n${failures === 0 ? "All probes passed." : `${failures} probe failure(s).`}\n`);
process.exit(failures === 0 ? 0 : 1);
