import { agrees, POOL_CLUSTER_TOLERANCE } from "./policy";
import type { ChartHistory, MarketValidation, PriceHistory } from "./types";

/**
 * 4H market context chart. Display only: nothing here is read by any risk rule,
 * by price validation or by the history contradiction check (withHistory).
 */
export const MAX_CHART_POOLS = 3;
export const MIN_CHART_POINTS = 6;

/** Corroborated pools, deepest first: the only pools a chart may be drawn from. */
export function chartCandidates(v: MarketValidation): { pairAddress: string; dexId: string }[] {
  return [...v.pairs].filter(p => p.pairAddress)
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd || a.pairAddress!.localeCompare(b.pairAddress!))
    .slice(0, MAX_CHART_POOLS).map(p => ({ pairAddress: p.pairAddress!, dexId: p.dexId }));
}

/**
 * Whether a history series is defensible 4h context for the requested mint:
 * requested-mint USD candles with proven orientation (never an inverted other
 * token), at least six closes in the four-hour window, and a latest close
 * consistent with the validated spot price (existing cluster tolerance), so a
 * stale or mispriced pool is never drawn as the token's market.
 */
export function chartAcceptance(history: PriceHistory, mint: string, pool: string, spotUsd: number | null): { ok: true } | { ok: false; reason: string; transient: boolean } {
  if (history.transient) return { ok: false, reason: history.error ?? "History provider temporarily unavailable", transient: true };
  if (history.mint !== mint || history.pool !== pool || !history.side) return { ok: false, reason: history.error ?? "History identity or orientation unproven", transient: false };
  if (!history.available || history.points.length < MIN_CHART_POINTS) return { ok: false, reason: history.error ?? `Fewer than ${MIN_CHART_POINTS} closes in the four-hour window`, transient: false };
  if (spotUsd === null) return { ok: false, reason: "No validated price to check the history against", transient: false };
  const latest = history.points[history.points.length - 1];
  if (!agrees(latest.p, spotUsd, POOL_CLUSTER_TOLERANCE)) return { ok: false, reason: "Latest close is inconsistent with the validated price", transient: false };
  return { ok: true };
}

/** Assemble the chart record from per-pool attempts (first acceptable wins, in depth order). */
export function buildChart(v: MarketValidation, attempts: { pool: string; dexId: string; history: PriceHistory | null; skipped?: string }[],
  retryAfterMs: number | null): ChartHistory {
  const candidates = chartCandidates(v);
  const log: ChartHistory["attempts"] = [];
  if (v.price.value === null || v.status === "conflict") {
    return { status: "unavailable", points: [], pool: null, dexId: null, fetchedAt: null, source: null, candidates: [], attempts: [], retryAfterMs: null,
      reason: v.status === "conflict" ? "Market data conflict" : "No validated price, so no verified pool to chart" };
  }
  if (!candidates.length) return { status: "unavailable", points: [], pool: null, dexId: null, fetchedAt: null, source: null, candidates, attempts: [], retryAfterMs: null,
    reason: "No independently corroborated pool to chart" };
  let transient = false;
  for (const a of attempts) {
    if (!a.history) { log.push({ pool: a.pool, outcome: a.skipped ?? "not attempted" }); transient = true; continue; }
    const verdict = chartAcceptance(a.history, v.mint, a.pool, v.price.value);
    if (verdict.ok) {
      log.push({ pool: a.pool, outcome: "accepted" });
      return { status: "available", points: a.history.points, pool: a.pool, dexId: a.dexId, fetchedAt: a.history.fetchedAt, source: "geckoterminal 5-minute requested-mint USD closes",
        candidates, attempts: log, retryAfterMs: null, reason: `${a.history.points.length} closes from the ${log.length === 1 ? "deepest" : "next"} corroborated pool` };
    }
    transient ||= verdict.transient;
    log.push({ pool: a.pool, outcome: verdict.reason });
  }
  return { status: transient ? "deferred" : "unavailable", points: [], pool: null, dexId: null, fetchedAt: null, source: null, candidates, attempts: log,
    retryAfterMs: transient ? retryAfterMs ?? 0 : null,
    reason: transient ? "History provider temporarily rate-limited; the chart will retry the corroborated pools" : log.map(l => `${l.pool.slice(0, 8)}…: ${l.outcome}`).join("; ") };
}
