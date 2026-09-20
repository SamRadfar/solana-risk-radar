/**
 * Shared types for the risk engine and the data it consumes.
 * These are the contract between data providers, the scoring engine, and the UI.
 */

export type Severity = "none" | "low" | "medium" | "high" | "critical";

export type SignalStatus = "ok" | "unavailable";

/** The output of a single deterministic risk rule. */
export interface RiskSignal {
  /** Stable machine id, e.g. "mint-authority" */
  id: string;
  /** Short label shown in the UI, e.g. "Mint Authority" */
  label: string;
  /** Category grouping used for layout, e.g. "Authorities" */
  category: "Authorities" | "Holders" | "Liquidity" | "Market Activity";
  /** Whether this signal could be computed at all */
  status: SignalStatus;
  /** The raw observed value, formatted for display, e.g. "38.4% of supply" */
  observedValue: string;
  /** Deterministic severity bucket assigned to the observed value */
  severity: Severity;
  /** Max points this signal can contribute to the overall score */
  maxPoints: number;
  /** Points actually contributed (0 when status is "unavailable") */
  points: number;
  /** Human-readable explanation of why this severity was assigned */
  explanation: string;
  /** Raw supporting data the UI can render in an "inspect evidence" panel */
  evidence: Record<string, unknown>;
}

export type RiskClassification =
  | "Low Risk Signals"
  | "Moderate Risk Signals"
  | "Elevated Risk Signals"
  | "High Risk Signals"
  | "Insufficient Data";

export interface TokenOverview {
  mint: string;
  name: string | null;
  symbol: string | null;
  decimals: number;
  supply: string;
  supplyUi: number;
  priceUsd: number | null;
  imageUrl: string | null;
}

export interface RiskReport {
  overview: TokenOverview;
  signals: RiskSignal[];
  score: number | null;
  classification: RiskClassification;
  availableWeight: number;
  totalWeight: number;
  generatedAt: string;
  warnings: string[];
}
