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
  ["USDC", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
  ["Wrapped SOL", "So11111111111111111111111111111111111111112"],
  ["BONK", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"],
  ["JUP", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"],
  ["PYUSD (Token-2022)", "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"],
  ["JitoSOL", "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"],
  ["PENGU", "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv"],
  ["TRUMP", "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN"],
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

    const { overview, score, classification, coveragePercent, signals, categories } = body;
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
