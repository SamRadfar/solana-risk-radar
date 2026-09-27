export const ACTIVITY_VERSION = "activity-intelligence-v0.2";
export const WINDOW_MS = 60 * 60_000;
export const MAX_POOLS = 3;
export const BUDGET_MS = 15_000;
export const FRESH_MS = 60_000;
export const RETENTION_MS = 5 * 60_000;
// Acquisition budgets, calibrated from live Helius payloads (2026-09-27, SOL/USDC/JUP pools):
// successful parsed records with raw transactions measured median 15 KiB (direct swaps) to 65 KiB
// (routed), max 108.6 KiB; a successful-signature listing entry is ~225 bytes.
/** One successful-signature listing request per pool; no listing pagination. */
export const SIGNATURES_PER_POOL = 1_000;
/** Parsed envelopes fetched (after server-side failure filtering and cross-pool deduplication). */
export const MAX_PARSED_RECORDS = 500;
export const PARSE_BATCH_MAX = 50;
/** Stop instead of issuing tail batches smaller than this (live tails of 1-15 records exhausted the request budget). */
export const PARSE_BATCH_MIN = 10;
/** Planning ceiling per parsed record: next batch is sized so it cannot overrun a byte cap even at this size. */
export const PLANNING_RECORD_BYTES = 112 * 1024;
export const MAX_REQUESTS = 20;
/** Parsed Events is metered as a Helius "Enhanced API" (documented 2 rps Free / 10 rps Developer).
 * Live runs hit HTTP 429 after ~8 unpaced and ~10 requests at 4 rps, so parse calls are paced at the
 * lowest documented tier. About 5 s of the 15 s deadline at the 10-batch maximum. */
export const PARSE_MIN_INTERVAL_MS = 500;
export const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
// Measurement eligibility, not risk/severity thresholds. Always disclose them.
export const MIN_ACTIONS = 20;
export const MIN_PARSER_COVERAGE = 0.8;
/** Trader-dependent metrics require this many resolved actions in the resolved subset itself. */
export const MIN_RESOLVED_ACTIONS = 20;
// Intentionally narrow decoding scope. More venues require contract fixtures.
export const SUPPORTED_PROGRAMS: Record<string, { venue: string; poolField: string; swaps: string[] }> = {
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: {
    venue: "Raydium CPMM", poolField: "pool_state", swaps: ["swap_base_input", "swap_base_output"],
  },
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: {
    venue: "Orca Whirlpool", poolField: "whirlpool", swaps: ["swap", "swap_v2"],
  },
};
// Documented block-builder tip recipients only. Anything else stays an unallocated SOL transfer.
// Jito: block-engine getTipAccounts (verified 2026-09-27). Helius Sender: helius.dev/docs/sending-transactions/sender.
export const TIP_ACCOUNTS: Record<string, string> = Object.fromEntries([
  ...["96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5", "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe", "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49", "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh", "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL", "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"].map(a => [a, "Jito"]),
  ...["4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE", "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ", "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
    "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn", "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD", "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
    "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF", "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT", "4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey",
    "4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or"].map(a => [a, "Helius Sender"]),
]);
