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

/** Per-category roll-up. Categories are the unit the overall score aggregates. */
export interface CategoryScore {
  category: RiskCategory;
  points: number;
  maxPoints: number;
  /** 0-100 risk within this category, or null when nothing was measurable. */
  percent: number | null;
  signalCount: number;
  /** This category's weight in the overall score. */
  weight: number;
}

/** How many signals landed in each severity bucket. */
export interface SignalCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  none: number;
  unavailable: number;
}

/** A single headline concern, ranked by its actual contribution to the score. */
export interface TopConcern {
  id: string;
  label: string;
  observedValue: string;
  severity: Severity;
  category: RiskCategory;
}

/**
 * The at-a-glance layer: everything needed to understand the verdict without
 * reading the full report. Assembled deterministically from the signals.
 */
export interface RiskSummary {
  counts: SignalCounts;
  /** Up to three highest-contributing concerns. */
  topConcerns: TopConcern[];
  /** Categories at or above the driver threshold, worst first. */
  drivers: RiskCategory[];
  /** Categories clean enough to count as offsetting, cleanest first. */
  offsets: RiskCategory[];
  /** One sentence explaining why the score is what it is. */
  rationale: string;
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
  /** Holders 2-10 combined — the figure the spread signal actually scores. */
  next9Share: number | null;
  reason?: string;
}

/**
 * Market figures for display, carried alongside the report.
 *
 * Every field is produced by the existing aggregate helpers in the market
 * provider — nothing here is recomputed, re-derived or independently sourced.
 * It exists so the UI can show what the engine already measured without
 * scraping it back out of signal text.
 *
 * `priceUsd` and `marketCapUsd` are deliberately the same canonical values as
 * the ones on `TokenOverview`, so a price shown in two places can never
 * disagree with itself.
 */
export interface MarketSnapshot {
  /** False when the market provider returned nothing for this mint. */
  available: boolean;
  priceUsd: number | null;
  priceChange24hPercent: number | null;
  marketCapUsd: number | null;
  fullyDilutedUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  poolCount: number;
  /**
   * The pool the canonical price came from. Carried so the market-context
   * chart reads the same market the price does, and so that reading stays
   * traceable to a source.
   */
  poolAddress: string | null;
  /** That pool's DEX, for attribution. */
  poolDex: string | null;
}

/**
 * Why every market figure in the report is what it is.
 *
 * Carried on the response but never rendered: it exists so that a wrong number
 * can be traced to the pool that produced it and the rule that admitted or
 * rejected it, without re-running the analysis by hand.
 */
export interface MarketDiagnostics {
  method: string;
  confidence: "high" | "medium" | "low" | "none";
  consideredPools: number;
  acceptedPools: number;
  rejectedPools: number;
  /** Liquidity-weighted mean relative deviation across accepted markets. */
  dispersion: number | null;
  /** Share of priced liquidity standing behind the accepted cluster. */
  liquidityShare: number | null;
  canonicalPriceUsd: number | null;
  /** The inputs each valuation was built from, stated separately. */
  marketCapInputs: { priceUsd: number; circulatingSupply: number } | null;
  fullyDilutedInputs: { priceUsd: number; totalSupply: number } | null;
  supplySource: string;
  totalSupplyUi: number;
  /** The pool the 4h history is read from; always an accepted one. */
  historyPool: string | null;
  pools: {
    dexId: string;
    pairAddress: string | null;
    quoteSymbol: string | null;
    priceUsd: number;
    liquidityUsd: number;
    volume24hUsd: number;
    weight: number;
    accepted: boolean;
    rejection?: string;
    deviation?: number;
  }[];
}

export interface DataSourceStatus {
  name: string;
  detail: string;
  ok: boolean;
}

export interface RiskReport {
  overview: TokenOverview;
  signals: RiskSignal[];
  summary: RiskSummary;
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
  /** Market figures for display. Never an input to the score. */
  market: MarketSnapshot;
  /** How those figures were established. Developer-facing, never rendered. */
  diagnostics: MarketDiagnostics;
  generatedAt: string;
  elapsedMs: number;
  warnings: string[];
}
