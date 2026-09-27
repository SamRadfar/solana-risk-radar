export const ACTIVITY_VERSION = "activity-intelligence-v0.1";
export const WINDOW_MS = 60 * 60_000;
export const MAX_RECORDS = 1_000;
export const MAX_REQUESTS = 15;
export const MAX_POOLS = 3;
export const BUDGET_MS = 15_000;
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
export const FRESH_MS = 60_000;
export const RETENTION_MS = 5 * 60_000;
// Measurement eligibility, not risk/severity thresholds. Always disclose them.
export const MIN_ACTIONS = 20;
export const MIN_PARSER_COVERAGE = 0.8;
export const MIN_TRADER_COVERAGE = 0.8;
// Intentionally narrow decoding scope. More venues require contract fixtures.
export const SUPPORTED_PROGRAMS: Record<string, { venue: string; poolField: string; swaps: string[] }> = {
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: {
    venue: "Raydium CPMM", poolField: "pool_state", swaps: ["swap_base_input", "swap_base_output"],
  },
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: {
    venue: "Orca Whirlpool", poolField: "whirlpool", swaps: ["swap", "swap_v2"],
  },
};
