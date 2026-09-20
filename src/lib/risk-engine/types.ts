/**
 * Shared types for the risk engine and the data it consumes.
 * These are the contract between data providers, the scoring engine, and the UI.
 */

export type Severity = "none" | "low" | "medium" | "high" | "critical";

export type SignalStatus = "ok" | "unavailable";

export const RISK_CATEGORIES = [
  "Authorities",
  "Holders",
  "Liquidity",
  "Market Activity",
  "Maturity",
] as const;

export type RiskCategory = (typeof RISK_CATEGORIES)[number];

/** A single piece of raw, inspectable supporting data behind a signal. */
export interface Evidence {
  label: string;
  value: string;
  /** Optional block-explorer or DEX link. */
  href?: string;
}

/** The output of a single deterministic risk rule. */
export interface RiskSignal {
  /** Stable machine id, e.g. "mint-authority". */
  id: string;
  /** Short label shown in the UI, e.g. "Mint Authority". */
  label: string;
  category: RiskCategory;
  /** What this rule measures, e.g. "Share of circulating supply". */
  metric: string;
  /** Whether this signal could be computed at all. */
  status: SignalStatus;
  /** The observed value, formatted for display, e.g. "38.4% of supply". */
  observedValue: string;
  /** Deterministic severity bucket assigned to the observed value. */
  severity: Severity;
  /** Max points this signal can contribute to the overall score. */
  maxPoints: number;
  /** Points actually contributed (always 0 when status is "unavailable"). */
  points: number;
  /** Human-readable explanation of why this severity was assigned. */
  explanation: string;
  /** Raw supporting data rendered in the "inspect evidence" panel. */
  evidence: Evidence[];
}

export type RiskClassification =
  | "Low Risk Signals"
  | "Moderate Risk Signals"
  | "Elevated Risk Signals"
  | "High Risk Signals"
  | "Critical Risk Signals"
  | "Insufficient Data";

export interface TokenOverview {
  mint: string;
  name: string | null;
  symbol: string | null;
  decimals: number;
  supply: string;
  supplyUi: number;
  supplyIsMeaningful: boolean;
  priceUsd: number | null;
  marketCapUsd: number | null;
  imageUrl: string | null;
  tokenProgram: string;
  metadataSource: string;
  websites: string[];
  socials: string[];
}

/** Per-category roll-up, used for the radar visualisation. */
export interface CategoryScore {
  category: RiskCategory;
  points: number;
  maxPoints: number;
  /** 0-100 risk within this category, or null when nothing was measurable. */
  percent: number | null;
  signalCount: number;
}

/** A single top holder, already classified. Rendered as the distribution table. */
export interface DistributionHolder {
  owner: string | null;
  tokenAccount: string;
  amountUi: number;
  /** Share of total supply, 0-1. */
  share: number;
  kind: "pool" | "burn" | "custodian" | "wallet" | "contract";
  label: string | null;
}

export interface Distribution {
  available: boolean;
  holders: DistributionHolder[];
  pooledShare: number;
  burnedShare: number;
  topHolderShare: number | null;
  top10Share: number | null;
  reason?: string;
}

export interface DataSourceStatus {
  name: string;
  detail: string;
  ok: boolean;
}

export interface RiskReport {
  overview: TokenOverview;
  signals: RiskSignal[];
  distribution: Distribution;
  categories: CategoryScore[];
  /** 0-100, where 100 is the most risk. `null` when nothing was measurable. */
  score: number | null;
  classification: RiskClassification;
  availableWeight: number;
  totalWeight: number;
  /** Percentage of total rule weight that could actually be evaluated. */
  coveragePercent: number;
  sources: DataSourceStatus[];
  generatedAt: string;
  elapsedMs: number;
  warnings: string[];
}
