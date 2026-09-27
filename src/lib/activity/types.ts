export type ActivityStatus = "MEASURED" | "PARTIAL" | "INSUFFICIENT_DATA" | "UNAVAILABLE";
export interface ActivityPool {
  address: string;
  program: string;
  venue: string;
  baseMint: string;
  quoteMint: string;
}
export interface ActivityTrade {
  signature: string;
  slot: number;
  blockTime: number;
  success: true;
  mint: string;
  pools: string[];
  programs: string[];
  traderAddress: string | null;
  traderResolutionStatus: "RESOLVED" | "PARTIAL" | "UNRESOLVED";
  traderResolutionProvenance: string;
  side: "BUY" | "SELL" | "UNKNOWN";
  baseAmountRaw: string;
  baseDecimals: number;
  quoteAmountRaw: string | null;
  quoteMint: string | null;
  quoteDecimals: number | null;
  amountProvenance: string;
  /** Non-root SOL transfers accepted as value-neutral to the requested-token interpretation. */
  ancillarySolTransfers: AncillarySolTransfer[];
  economicActionId: string;
  source: "helius-parsed-events";
  rawEvidenceReference: string;
}
export interface AncillarySolTransfer {
  kind: "zero-value" | "self-wrap" | "tip";
  lamports: string;
  recipient: string;
  /** Tip service for documented tip accounts; null otherwise. */
  service: string | null;
}
export interface ShareMetric {
  numerator: string;
  denominator: string;
  share: number | null;
  resolvedCoverage: number | null;
  recordCount: number;
  walletsIncluded: number;
}
/** Trader-dependent groups are null when the resolved subset is not eligible (see `metrics`). */
export interface ActivityFeatures {
  uniqueBuyers: number | null;
  uniqueSellers: number | null;
  concentration: null | {
    basis: "resolved economic actions; volume in requested-token raw units";
    trade: { top1: ShareMetric; top5: ShareMetric; top10: ShareMetric };
    volume: { top1: ShareMetric; top5: ShareMetric; top10: ShareMetric };
  };
  cycling: null | {
    walletsWithCycles: number;
    cycleCount: number;
    buySellTransitions: number;
    sellBuyTransitions: number;
    roundTripCount: number;
    holdingIntervalsSeconds: number[];
    ambiguousSameSlotPairs: number;
    definition: string;
  };
  inventory: null | { trader: string; grossTradedRaw: string; netSwapFlowRaw: string; actualInventoryChangeRaw: null }[];
  repeatedSizes: null | { repeatedGroups: number; recordsInRepeatedGroups: number; eligibleRecords: number; basis: string };
  cadence: null | { distinctSlots: number; sameSlotActions: number; intervalCount: number; minSeconds: number | null; medianSeconds: number | null; maxSeconds: number | null; precision: string };
}
export type ActivityMetricName = "repeatedSizes" | "cadence" | "participants" | "concentration" | "cycling" | "inventory";
export interface ActivityMetricEligibility {
  status: ActivityStatus;
  basis: "all-normalized-actions" | "resolved-trader-subset";
  /** Actions in the metric's basis. */
  sampleSize: number;
  requiredSampleSize: number;
  /** Basis actions / all normalized actions. */
  actionCoverage: number | null;
  /** Basis requested-token volume / all normalized requested-token volume. */
  volumeCoverage: number | null;
  reasons: string[];
}
export interface ActivityEvidenceResult {
  version: string;
  observationOnly: true;
  mint: string;
  snapshotId: string;
  status: ActivityStatus;
  requestedWindow: { from: number; to: number };
  requestedWindowMs: number;
  observedWindow: { from: number; to: number; lengthMs: number } | null;
  fetchedAt: number;
  expiresAt: number;
  requestCount: number;
  bytesReceived: number;
  elapsedMs: number;
  /** Failed transactions are removed server-side by the signature listing (`status: succeeded`). */
  failedTransactionFilter: "server-side-succeeded-only";
  signaturesListed: number;
  /** Listed successful signatures not fetched because of the common listing frontier or parse budgets. */
  signaturesNotFetched: number;
  recordsReceived: number;
  recordsExamined: number;
  duplicateRecords: number;
  economicActions: number;
  successfulParses: number;
  failedParses: number;
  failedTransactions: number;
  excludedRecords: number;
  parserCoverage: number | null;
  resolvedTraderCount: number;
  unresolvedTraderCount: number;
  traderResolutionCoverage: number | null;
  poolsCovered: ActivityPool[];
  poolWindows: { pool: string; reachedWindowStart: boolean; oldestRecordAt: number | null }[];
  providersUsed: string[];
  truncated: boolean;
  stoppingReasons: string[];
  errors: string[];
  exclusions: Record<string, number>;
  metrics: Record<ActivityMetricName, ActivityMetricEligibility> | null;
  features: ActivityFeatures | null;
  evidence: ActivityTrade[];
  limitations: string[];
}
export interface ActivitySnapshot {
  result: ActivityEvidenceResult;
  raw: Record<string, unknown>;
}
