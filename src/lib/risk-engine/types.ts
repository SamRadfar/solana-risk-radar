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
  /** Token accounts this holding was aggregated from. */
  accountCount: number;
  /** Verified control structure; never inferred from balance or inactivity. */
  attributes: string[];
  /** Decoded m-of-n, only when the multisig program allows it to be read. */
  multisig: { threshold: number; signers: number } | null;
  /** Share of total supply in this holding that provably cannot move. */
  lockedShare: number;
}

export interface Distribution {
  available: boolean;
  holders: DistributionHolder[];
  pooledShare: number;
  burnedShare: number;
  topHolderShare: number | null;
  /** Largest holder's share after verified restrictions. Never replaces it. */
  effectiveTopHolderShare: number | null;
  /** Share of circulating supply under a verified, enforced restriction. */
  verifiedLockedShare: number;
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

// ---------------------------------------------------------------------------
// Liquidity safety — verified LP lock and burn state.
//
// Informational only. Nothing in this block is an input to any rule, to any
// severity, or to the score: it is evidence the reader can act on, presented
// beside the liquidity signals rather than folded into them.
// ---------------------------------------------------------------------------

/**
 * How a single LP holding is held.
 *
 * The vocabulary is deliberately narrow, and each term means one thing:
 *
 * - `burned` — held where it can never be redeemed, so the pool reserves
 *   behind it are permanently stranded. This is the only permanent class.
 * - `frozen` — the LP token account is frozen, so it cannot be transferred
 *   today. The freeze authority can lift it, so it is not permanent.
 * - `lock-program` — custodied by a known LP lock program. Verifiable from the
 *   owning program id; the release schedule is *not* readable, so this is
 *   disclosed but never counted as locked.
 * - `staked` — deposited in a farm or staking program. Withdrawable, and
 *   explicitly not a lock, however long it has sat there.
 * - `program` — owned by some other on-chain program. No lock is implied.
 * - `wallet` / `unknown` — an ordinary account. Withdrawable.
 */
export type LpCustodyClass =
  | "burned"
  | "frozen"
  | "lock-program"
  | "staked"
  | "program"
  | "wallet"
  | "unknown";

/** One LP token account, resolved to its owner and classified. */
export interface LpHolding {
  tokenAccount: string;
  owner: string | null;
  /** Share of this pool's LP supply, 0-1. */
  share: number;
  custody: LpCustodyClass;
  /** Registry label for the owning program or address, when one is known. */
  label: string | null;
}

/**
 * One pool's LP custody.
 *
 * `unmeasuredReason` is the load-bearing field: when it is set, every fraction
 * below is null and the pool contributes nothing to the aggregate. A pool that
 * could not be read never becomes a pool with nothing locked.
 */
export interface LiquiditySafetyPool {
  pairAddress: string;
  dexId: string;
  liquidityUsd: number;
  /** Null for venues with no fungible LP token, and whenever unmeasured. */
  lpMint: string | null;
  /** Plain-language reason this pool was skipped, or null when it was read. */
  unmeasuredReason: string | null;
  lpSupplyRaw: string | null;
  lpDecimals: number | null;
  /** All 0-1 shares of this pool's LP supply. Null when unmeasured. */
  burnedFraction: number | null;
  frozenFraction: number | null;
  lockCustodyFraction: number | null;
  withdrawableFraction: number | null;
  /** LP supply outside the 20 largest accounts — read, but not attributable. */
  unattributedFraction: number | null;
  holders: LpHolding[];
}

/**
 * Verified liquidity lock and burn state for the token.
 *
 * Every `*Percent` field is a **0-1 fraction of measured liquidity**, not of
 * all liquidity and not a 0-100 number — `coverage` says how much of the market
 * those fractions describe. `null` everywhere means "not measured", which is
 * never the same as zero.
 *
 * `burnedPercent` is a **subset** of `lockedPercent`, never an addend. The two
 * are reported as "X% locked, of which Y% burned"; summing them is the error
 * this shape exists to prevent.
 */
export interface LiquiditySafety {
  /**
   * `measured` — nearly all liquidity was read.
   * `partial` — some was, and `coverage` says how much.
   * `unmeasured` — none of it could be read. No percentage is stated.
   * `no-liquidity` — there is no market to measure in the first place.
   */
  status: "measured" | "partial" | "unmeasured" | "no-liquidity";
  confidence: "high" | "medium" | "low" | "none";
  /** The same consensus total the rest of the report shows. */
  totalLiquidityUsd: number | null;
  measuredLiquidityUsd: number;
  /** `measuredLiquidityUsd / totalLiquidityUsd`, 0-1. */
  coverage: number | null;
  /** Provably non-withdrawable: burned plus frozen. Contains `burnedPercent`. */
  lockedPercent: number | null;
  /** Permanently unredeemable. A component of `lockedPercent`. */
  burnedPercent: number | null;
  /** Under lock-program custody. Disclosed, and deliberately not "locked". */
  lockCustodyPercent: number | null;
  unlockedPercent: number | null;
  unattributedPercent: number | null;
  /** `"permanent"`, or null when no expiry could be verified. Never guessed. */
  lockExpiry: string | null;
  /** Burn destinations and lock programs actually observed. */
  lockProvider: string | null;
  sources: string[];
  pools: LiquiditySafetyPool[];
  evidence: Evidence[];
  /** Caveats worth stating in prose — coverage gaps, unattributed supply. */
  notes: string[];
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
  /**
   * Verified LP lock and burn state. Informational evidence only — like
   * `market`, it is displayed beside the signals and never scored.
   */
  liquiditySafety: LiquiditySafety;
  /** How those figures were established. Developer-facing, never rendered. */
  diagnostics: MarketDiagnostics;
  generatedAt: string;
  elapsedMs: number;
  warnings: string[];
}
