import { MIN_ACTIONS, MIN_PARSER_COVERAGE, MIN_RESOLVED_ACTIONS } from "./policy";
import type { ActivityEvidenceResult, ActivityFeatures, ActivityMetricEligibility, ActivityMetricName, ActivityStatus, ActivityTrade, ShareMetric } from "./types";

const ratio = (n: bigint, d: bigint): number | null => d === BigInt(0) ? null : Number(n * BigInt(1_000_000) / d) / 1_000_000;
const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Every group computed; publication is gated separately by `eligibleFeatures`. */
export type MeasuredFeatures = { [K in keyof ActivityFeatures]: NonNullable<ActivityFeatures[K]> };
export function measureActivity(actions: ActivityTrade[]): MeasuredFeatures {
  const resolved = actions.filter(isResolvedAction);
  const wallets = new Map<string, ActivityTrade[]>();
  for (const action of resolved) wallets.set(action.traderAddress!, [...(wallets.get(action.traderAddress!) ?? []), action]);
  const volumes = [...wallets.values()].map(rows => rows.reduce((sum, a) => sum + BigInt(a.baseAmountRaw), BigInt(0)));
  const counts = [...wallets.values()].map(rows => BigInt(rows.length));
  const observedVolume = actions.reduce((sum, a) => sum + BigInt(a.baseAmountRaw), BigInt(0));
  function concentration(values: bigint[], observed: bigint) {
    const sorted = [...values].sort((a, b) => a === b ? 0 : a > b ? -1 : 1);
    const total = sorted.reduce((a, b) => a + b, BigInt(0));
    const top = (n: number): ShareMetric => {
      const numerator = sorted.slice(0, n).reduce((a, b) => a + b, BigInt(0));
      return { numerator: numerator.toString(), denominator: total.toString(), share: ratio(numerator, total),
        resolvedCoverage: ratio(total, observed), recordCount: resolved.length, walletsIncluded: Math.min(n, sorted.length) };
    };
    return { top1: top(1), top5: top(5), top10: top(10) };
  }
  let buySellTransitions = 0, sellBuyTransitions = 0, walletsWithCycles = 0, roundTripCount = 0, ambiguousSameSlotPairs = 0;
  const intervals: number[] = [];
  const inventory: ActivityFeatures["inventory"] = [];
  for (const [trader, rows] of wallets) {
    const sorted = [...rows].sort((a, b) => a.slot - b.slot || a.signature.localeCompare(b.signature));
    const slotCounts = new Map<number, number>();
    for (const row of sorted) slotCounts.set(row.slot, (slotCounts.get(row.slot) ?? 0) + 1);
    let transitions = 0, pairedUntil = -1;
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1], b = sorted[i];
      if (a.slot === b.slot) ambiguousSameSlotPairs++;
      if (slotCounts.get(a.slot)! > 1 || slotCounts.get(b.slot)! > 1) continue;
      if (a.side === b.side || b.blockTime < a.blockTime) continue;
      transitions++;
      if (a.side === "BUY") buySellTransitions++; else sellBuyTransitions++;
      intervals.push(b.blockTime - a.blockTime);
      if (i - 1 > pairedUntil && a.baseAmountRaw === b.baseAmountRaw) { roundTripCount++; pairedUntil = i; }
    }
    if (transitions) walletsWithCycles++;
    inventory.push({ trader, grossTradedRaw: rows.reduce((n, a) => n + BigInt(a.baseAmountRaw), BigInt(0)).toString(),
      netSwapFlowRaw: rows.reduce((n, a) => n + (a.side === "BUY" ? BigInt(1) : -BigInt(1)) * BigInt(a.baseAmountRaw), BigInt(0)).toString(),
      actualInventoryChangeRaw: null });
  }
  const sizes = new Map<string, number>();
  for (const a of actions) {
    const key = `${a.mint}:${a.baseDecimals}:${a.side}:${a.baseAmountRaw}`;
    sizes.set(key, (sizes.get(key) ?? 0) + 1);
  }
  const groups = [...sizes.values()].filter(count => count > 1);
  const ordered = [...actions].sort((a, b) => a.slot - b.slot || a.signature.localeCompare(b.signature));
  const gaps = ordered.slice(1).flatMap((b, i) => b.slot !== ordered[i].slot && b.blockTime >= ordered[i].blockTime ? [b.blockTime - ordered[i].blockTime] : []);
  return {
    uniqueBuyers: new Set(resolved.filter(a => a.side === "BUY").map(a => a.traderAddress)).size,
    uniqueSellers: new Set(resolved.filter(a => a.side === "SELL").map(a => a.traderAddress)).size,
    concentration: { basis: "resolved economic actions; volume in requested-token raw units",
      trade: concentration(counts, BigInt(actions.length)), volume: concentration(volumes, observedVolume) },
    cycling: { walletsWithCycles, cycleCount: buySellTransitions + sellBuyTransitions, buySellTransitions, sellBuyTransitions,
      roundTripCount, holdingIntervalsSeconds: intervals, ambiguousSameSlotPairs,
      definition: "Cycles are adjacent opposite-side observations per address. Round trips are non-overlapping, equal requested-token-amount opposite-side pairs across different slots. Intervals are observed trade gaps, not proven holding periods. Missing trades/transfers can change interpretation." },
    inventory,
    repeatedSizes: { repeatedGroups: groups.length, recordsInRepeatedGroups: groups.reduce((a, b) => a + b, 0), eligibleRecords: actions.length,
      basis: "Exact integer requested-token amounts, grouped by decimals and side, after routing deduplication. Preset UI amounts and round quote sizes can repeat legitimately; no behavioral classification." },
    cadence: { distinctSlots: new Set(actions.map(a => a.slot)).size, sameSlotActions: actions.length - new Set(actions.map(a => a.slot)).size,
      intervalCount: gaps.length, minSeconds: gaps.length ? Math.min(...gaps) : null, medianSeconds: median(gaps), maxSeconds: gaps.length ? Math.max(...gaps) : null,
      precision: "Block-time seconds between distinct slots; intra-slot order/timing is unknown." },
  };
}

const TRADER_INDEPENDENT: ActivityMetricName[] = ["repeatedSizes", "cadence"];
const TRADER_DEPENDENT: ActivityMetricName[] = ["participants", "concentration", "cycling", "inventory"];
export const isResolvedAction = (a: ActivityTrade) => a.traderResolutionStatus === "RESOLVED" && a.traderAddress !== null && a.side !== "UNKNOWN";

/** Per-metric data-quality eligibility. Trader-independent metrics use every normalized action;
 * trader-dependent metrics use only the resolved subset, which must itself meet the sample gate
 * and always disclose its action/volume coverage. Gates are data quality, not risk thresholds.
 */
export function assessMetrics(result: ActivityEvidenceResult): Record<ActivityMetricName, ActivityMetricEligibility> {
  const actions = result.evidence, resolved = actions.filter(isResolvedAction);
  const volume = (rows: ActivityTrade[]) => rows.reduce((sum, a) => sum + BigInt(a.baseAmountRaw), BigInt(0));
  const common: string[] = [];
  if (actions.length < MIN_ACTIONS) common.push(`${actions.length} normalized actions; ${MIN_ACTIONS} required`);
  if (result.parserCoverage === null || result.parserCoverage < MIN_PARSER_COVERAGE) {
    common.push(`Parser coverage ${result.parserCoverage === null ? "unavailable" : `${(result.parserCoverage * 100).toFixed(1)}%`}; ${MIN_PARSER_COVERAGE * 100}% required`);
  }
  const incomplete: string[] = [];
  if (result.truncated || result.poolWindows.some(p => !p.reachedWindowStart)) incomplete.push("Observed window does not cover the full requested window for every selected pool");
  if (result.errors.length) incomplete.push("Provider or budget error during acquisition");
  if (result.failedParses) incomplete.push(`${result.failedParses} candidate records could not be parsed`);
  function assess(name: ActivityMetricName): ActivityMetricEligibility {
    const dependent = TRADER_DEPENDENT.includes(name), basis = dependent ? resolved : actions;
    const reasons = [...common];
    if (dependent && basis.length < MIN_RESOLVED_ACTIONS) reasons.push(`${basis.length} resolved-trader actions; ${MIN_RESOLVED_ACTIONS} required in the resolved subset`);
    const total = volume(actions);
    const eligibility = {
      basis: dependent ? "resolved-trader-subset" as const : "all-normalized-actions" as const,
      sampleSize: basis.length, requiredSampleSize: dependent ? MIN_RESOLVED_ACTIONS : MIN_ACTIONS,
      actionCoverage: actions.length ? basis.length / actions.length : null,
      volumeCoverage: total > BigInt(0) ? Number(volume(basis) * BigInt(1_000_000) / total) / 1_000_000 : null,
    };
    if (!actions.length) return { status: "INSUFFICIENT_DATA", ...eligibility, reasons: reasons.length ? reasons : ["No normalized actions"] };
    if (reasons.length) return { status: "INSUFFICIENT_DATA", ...eligibility, reasons };
    const partial = [...incomplete];
    if (dependent && basis.length < actions.length) {
      partial.push(`Describes the resolved subset only: ${basis.length}/${actions.length} actions (${((eligibility.actionCoverage ?? 0) * 100).toFixed(1)}%), ${((eligibility.volumeCoverage ?? 0) * 100).toFixed(1)}% of requested-token volume. Unresolved actions (often routed) can differ systematically.`);
    }
    return { status: partial.length ? "PARTIAL" : "MEASURED", ...eligibility, reasons: partial };
  }
  return Object.fromEntries([...TRADER_INDEPENDENT, ...TRADER_DEPENDENT].map(name => [name, assess(name)])) as Record<ActivityMetricName, ActivityMetricEligibility>;
}

/** Withhold every metric group that is not eligible; never publish values below the gates. */
export function eligibleFeatures(features: MeasuredFeatures, metrics: Record<ActivityMetricName, ActivityMetricEligibility>): ActivityFeatures {
  const ok = (name: ActivityMetricName) => metrics[name].status === "MEASURED" || metrics[name].status === "PARTIAL";
  return {
    uniqueBuyers: ok("participants") ? features.uniqueBuyers : null,
    uniqueSellers: ok("participants") ? features.uniqueSellers : null,
    concentration: ok("concentration") ? features.concentration : null,
    cycling: ok("cycling") ? features.cycling : null,
    inventory: ok("inventory") ? features.inventory : null,
    repeatedSizes: ok("repeatedSizes") ? features.repeatedSizes : null,
    cadence: ok("cadence") ? features.cadence : null,
  };
}

/** Overall status summarizes metric statuses; it is not a separate gate. */
export function overallStatus(metrics: Record<ActivityMetricName, ActivityMetricEligibility>): ActivityStatus {
  const statuses = Object.values(metrics).map(m => m.status);
  if (statuses.every(s => s === "MEASURED")) return "MEASURED";
  if (statuses.every(s => s === "INSUFFICIENT_DATA")) return "INSUFFICIENT_DATA";
  return "PARTIAL";
}
