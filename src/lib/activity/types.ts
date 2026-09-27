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
  economicActionId: string;
  source: "helius-parsed-events";
  rawEvidenceReference: string;
}
export interface ShareMetric {
  numerator: string;
  denominator: string;
  share: number | null;
  resolvedCoverage: number | null;
  recordCount: number;
  walletsIncluded: number;
}
export interface ActivityFeatures {
  uniqueBuyers: number;
  uniqueSellers: number;
  concentration: {
    basis: "resolved economic actions; volume in requested-token raw units";
    trade: { top1: ShareMetric; top5: ShareMetric; top10: ShareMetric };
    volume: { top1: ShareMetric; top5: ShareMetric; top10: ShareMetric };
  };
  cycling: {
    walletsWithCycles: number;
    cycleCount: number;
    buySellTransitions: number;
    sellBuyTransitions: number;
    roundTripCount: number;
    holdingIntervalsSeconds: number[];
    ambiguousSameSlotPairs: number;
    definition: string;
  };
  inventory: { trader: string; grossTradedRaw: string; netSwapFlowRaw: string; actualInventoryChangeRaw: null }[];
  repeatedSizes: { repeatedGroups: number; recordsInRepeatedGroups: number; eligibleRecords: number; basis: string };
  cadence: { distinctSlots: number; sameSlotActions: number; intervalCount: number; minSeconds: number | null; medianSeconds: number | null; maxSeconds: number | null; precision: string };
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
  elapsedMs: number;
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
  features: ActivityFeatures | null;
  evidence: ActivityTrade[];
  limitations: string[];
}
export interface ActivitySnapshot {
  result: ActivityEvidenceResult;
  raw: Record<string, unknown>;
}
