import { validationOf, spotPrice, marketCap, contextualQuote } from "../market/access";

import {
  canonicalPair,
  fullyDilutedValuation,
  priceChange24h,
  totalLiquidity,
  totalVolume24h,
} from "../market/access";

import type { AnalysisInput, RiskRule } from "./input";
import {
  RISK_CATEGORIES,
  type CategoryScore,
  type DataSourceStatus,
  type Distribution,
  type RiskCategory,
  type RiskClassification,
  type RiskReport,
  type RiskSignal,
  type RiskSummary,
  type Severity,
  type SignalCounts,
  type TokenOverview,
} from "./types";
import {
  freezeAuthorityRule,
  metadataMutabilityRule,
  mintAuthorityRule,
  tokenExtensionsRule,
} from "./rules/authorities";
import { holderSpreadRule, topHolderRule } from "./rules/holders";
import {
  liquidityDepthRule,
  liquidityRatioRule,
  poolDiversityRule,
} from "./rules/liquidity";
import {
  priceVolatilityRule,
  tradeImbalanceRule,
  tradingActivityRule,
} from "./rules/market";
import { poolMaturityRule } from "./rules/maturity";

/**
 * The deterministic scoring engine.
 *
 * Every rule is a pure function of fetched data. Given identical inputs the
 * engine always produces an identical score — no model, no sampling, no
 * randomness anywhere in this path.
 */

export const RULES: RiskRule[] = [
  // Authorities — who retains control over the token after launch.
  mintAuthorityRule,
  freezeAuthorityRule,
  tokenExtensionsRule,
  metadataMutabilityRule,
  // Holders — how concentrated the sellable supply is.
  topHolderRule,
  holderSpreadRule,
  // Liquidity — whether a real market exists to exit into.
  liquidityDepthRule,
  liquidityRatioRule,
  poolDiversityRule,
  // Market activity — whether that market behaves normally.
  tradingActivityRule,
  tradeImbalanceRule,
  priceVolatilityRule,
  // Maturity — how long any of this has existed.
  poolMaturityRule,
];

/**
 * Category weights.
 *
 * Equal by design. Each category is a distinct way to lose money — the token
 * can be inflated or seized (Authorities), dumped on you (Holders), impossible
 * to exit (Liquidity), a fabricated market (Market Activity), or too new to
 * have any track record (Maturity). None substitutes for another, and there is
 * no defensible empirical basis for ranking them, so none is privileged.
 *
 * Because the score is normalised per category, a rule's weight only matters
 * *relative to other rules in its own category*. Adding a fifth Authorities
 * rule cannot dilute Liquidity.
 */
export const CATEGORY_WEIGHTS: Record<RiskCategory, number> = {
  Authorities: 20,
  Holders: 20,
  Liquidity: 20,
  "Market Activity": 20,
  Maturity: 20,
};

/**
 * The exponent of the power mean used to combine categories.
 *
 * p = 1 (a plain weighted average) treats risk dimensions as *substitutes*:
 * renouncing the mint authority would offset having no liquidity. That is
 * false, and it was the concrete failure of the previous scoring — a token one
 * day old with almost no liquidity scored 40, statistically indistinguishable
 * from USDT at 41.
 *
 * p = 2 makes the score the normalised Euclidean magnitude of the token's risk
 * vector across categories: severe dimensions dominate, clean ones still count,
 * and nothing is fully cancelled out. Higher exponents collapse toward "worst
 * category only" and throw away the rest of the profile.
 */
const CATEGORY_POWER = 2;

/**
 * Below this share of total rule weight, a score would be drawn from too little
 * evidence to mean anything, so "Insufficient Data" is reported instead.
 */
const MIN_COVERAGE_FOR_SCORE = 0.4;

/**
 * Classification bands, calibrated against measured mainnet tokens rather than
 * round numbers. See METHODOLOGY.md for the reference distribution.
 */
const BANDS: readonly [max: number, classification: RiskClassification][] = [
  [20, "Low Risk Signals"],
  [40, "Moderate Risk Signals"],
  [60, "Elevated Risk Signals"],
  [80, "High Risk Signals"],
  [Infinity, "Critical Risk Signals"],
];

export function classifyScore(
  score: number | null,
  hasEnoughCoverage: boolean,
): RiskClassification {
  if (score === null || !hasEnoughCoverage) return "Insufficient Data";
  return BANDS.find(([max]) => score < max)![1];
}

function summariseCategories(signals: RiskSignal[]): CategoryScore[] {
  return RISK_CATEGORIES.map((category) => {
    const inCategory = signals.filter((s) => s.category === category);
    const evaluated = inCategory.filter((s) => s.status === "ok");
    const maxPoints = evaluated.reduce((sum, s) => sum + s.maxPoints, 0);
    const points = evaluated.reduce((sum, s) => sum + s.points, 0);

    return {
      category,
      points,
      maxPoints,
      // Within a category the signals are facets of one risk dimension and are
      // partially substitutable, so they combine as a plain weighted mean.
      percent: maxPoints > 0 ? Math.round((points / maxPoints) * 100) : null,
      signalCount: inCategory.length,
      weight: CATEGORY_WEIGHTS[category],
    };
  });
}

/**
 * Combine category risk into one score: the weighted power mean over the
 * categories that could be measured. A category with nothing measurable is
 * dropped from both sides of the ratio rather than counted as clean.
 */
export function aggregateScore(categories: CategoryScore[]): number | null {
  let numerator = 0;
  let weight = 0;

  for (const category of categories) {
    if (category.percent === null) continue;
    const ratio = category.percent / 100;
    numerator += category.weight * ratio ** CATEGORY_POWER;
    weight += category.weight;
  }

  if (weight === 0) return null;
  return Math.round((numerator / weight) ** (1 / CATEGORY_POWER) * 100);
}

// ---------------------------------------------------------------------------
// Deterministic summary
// ---------------------------------------------------------------------------

/**
 * Phrasing per category. Fixed strings selected by measured thresholds — the
 * rationale sentence is assembled, never generated by a model.
 */
const CATEGORY_PHRASES: Record<RiskCategory, { risk: string; clean: string }> = {
  Authorities: { risk: "authority risk", clean: "renounced authorities" },
  Holders: { risk: "holder concentration", clean: "broad holder distribution" },
  Liquidity: { risk: "liquidity risk", clean: "deep liquidity" },
  "Market Activity": {
    risk: "trading-activity risk",
    clean: "normal trading activity",
  },
  Maturity: { risk: "maturity risk", clean: "an established track record" },
};

/** A category at or above this share of its weight is driving the score. */
const DRIVER_THRESHOLD = 50;
/** At or below this, a category is clean enough to describe as an offset. */
const OFFSET_THRESHOLD = 15;

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The intensity word is taken from the worst *finding* inside the driving
 * categories, not from the category percentage.
 *
 * A category can sit at 64% while containing a critical finding — TRUMP, where
 * one wallet holds 72.7% of supply, is exactly that shape. Describing that as
 * "moderate holder concentration" would contradict the critical signal shown
 * directly beneath it.
 */
function intensityFor(
  drivers: (CategoryScore & { percent: number })[],
  signals: RiskSignal[],
): string {
  const driverCategories = new Set(drivers.map((d) => d.category));
  const worst = signals
    .filter((s) => s.status === "ok" && driverCategories.has(s.category))
    .reduce((acc, s) => Math.max(acc, SEVERITY_RANK[s.severity]), 0);

  if (worst >= SEVERITY_RANK.critical) return "Severe";
  if (worst >= SEVERITY_RANK.high) return "Significant";
  return "Moderate";
}

function countSeverities(signals: RiskSignal[]): SignalCounts {
  const counts: SignalCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    none: 0,
    unavailable: 0,
  };
  for (const signal of signals) {
    if (signal.status === "unavailable") counts.unavailable += 1;
    else counts[signal.severity] += 1;
  }
  return counts;
}

const SEVERITY_RANK: Record<Severity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Build the at-a-glance summary.
 *
 * Concerns are ranked by how much risk each actually contributed — points
 * charged, then severity, then weight — so the list is derived from the same
 * numbers as the score rather than curated separately.
 */
export function buildSummary(
  signals: RiskSignal[],
  categories: CategoryScore[],
): RiskSummary {
  const measured = signals.filter((s) => s.status === "ok");

  const topConcerns = measured
    .filter((s) => s.severity !== "none")
    .sort(
      (a, b) =>
        b.points - a.points ||
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        b.maxPoints - a.maxPoints,
    )
    .slice(0, 3)
    .map((s) => ({
      id: s.id,
      label: s.label,
      observedValue: s.observedValue,
      severity: s.severity,
      category: s.category,
    }));

  const measuredCategories = categories.filter(
    (c): c is CategoryScore & { percent: number } => c.percent !== null,
  );

  const drivers = measuredCategories
    .filter((c) => c.percent >= DRIVER_THRESHOLD)
    .sort((a, b) => b.percent - a.percent);
  const offsets = measuredCategories
    .filter((c) => c.percent <= OFFSET_THRESHOLD)
    .sort((a, b) => a.percent - b.percent);

  return {
    counts: countSeverities(signals),
    topConcerns,
    drivers: drivers.map((c) => c.category),
    offsets: offsets.map((c) => c.category),
    rationale: buildRationale(measuredCategories, drivers, offsets, signals),
  };
}

function buildRationale(
  measured: (CategoryScore & { percent: number })[],
  drivers: (CategoryScore & { percent: number })[],
  offsets: (CategoryScore & { percent: number })[],
  signals: RiskSignal[],
): string {
  if (measured.length === 0) {
    return "No category could be measured, so no overall assessment is possible.";
  }

  const driverText = joinList(drivers.map((c) => CATEGORY_PHRASES[c.category].risk));
  // Three offsets is already a long clause; the category profile shows the rest.
  const offsetText = joinList(
    offsets.slice(0, 3).map((c) => CATEGORY_PHRASES[c.category].clean),
  );

  if (drivers.length === 0) {
    const worst = [...measured].sort((a, b) => b.percent - a.percent)[0];
    if (worst.percent === 0) {
      return "No risk signals fired in any category that could be measured.";
    }
    // Only the two cleanest offsets are named here; listing four makes the
    // sentence longer than the finding it describes.
    const briefOffsets = joinList(
      offsets.slice(0, 2).map((c) => CATEGORY_PHRASES[c.category].clean),
    );
    return `No category shows major risk. The highest is ${worst.category.toLowerCase()} at ${worst.percent}% of its measurable weight${
      briefOffsets ? `, alongside ${briefOffsets}` : ""
    }.`;
  }

  const intensity = intensityFor(drivers, signals);

  if (offsets.length === 0) {
    return `${intensity} ${driverText}, with no category scoring clean.`;
  }

  return `${intensity} ${driverText}, partially offset by ${offsetText}.`;
}

// ---------------------------------------------------------------------------

export interface BuildReportOptions {
  overview: TokenOverview;
  sources: DataSourceStatus[];
  elapsedMs: number;
}

export function buildRiskReport(
  input: AnalysisInput,
  { overview, sources, elapsedMs }: BuildReportOptions,
): RiskReport {
  const signals = RULES.map((rule) => rule(input));
  const categories = summariseCategories(signals);

  const totalWeight = signals.reduce((sum, s) => sum + s.maxPoints, 0);
  const availableWeight = signals
    .filter((s) => s.status === "ok")
    .reduce((sum, s) => sum + s.maxPoints, 0);

  const coverage = totalWeight > 0 ? availableWeight / totalWeight : 0;
  const hasEnoughCoverage = coverage >= MIN_COVERAGE_FOR_SCORE;
  const score = aggregateScore(categories);

  const warnings: string[] = [];
  const unavailable = signals.filter((s) => s.status === "unavailable");

  if (unavailable.length > 0) {
    warnings.push(
      `${unavailable.length} of ${signals.length} signals could not be measured (${unavailable
        .map((s) => s.label)
        .join(", ")}). They are excluded from the score rather than counted as clean.`,
    );
  }
  if (!hasEnoughCoverage) {
    warnings.push(
      `Only ${Math.round(coverage * 100)}% of the total signal weight could be evaluated — too little to produce a meaningful score. Treat the individual signals below as the result, not the overall number.`,
    );
  }

  const { holderData } = input;

  return {
    overview: { ...overview, priceUsd: spotPrice(input.marketData), marketCapUsd: marketCap(input.marketData) },
    signals,
    summary: buildSummary(signals, categories),
    distribution: {
      available: holderData.available,
      holders: holderData.holders.slice(0, 20).map((holder) => ({
        owner: holder.owner,
        tokenAccount: holder.tokenAccount,
        amountUi: holder.amountUi,
        share: holder.share,
        kind: holder.kind,
        label: holder.label,
        accountCount: holder.accountCount,
        attributes: holder.attributes,
        multisig: holder.multisig,
        lockedShare: holder.lockedShare,
      })),
      pooledShare: holderData.pooledShare,
      burnedShare: holderData.burnedShare,
      topHolderShare: holderData.topHolderShare,
      effectiveTopHolderShare: holderData.effectiveTopHolderShare,
      verifiedLockedShare: holderData.verifiedLockedShare,
      top10Share: holderData.top10Share,
      next9Share: holderData.next9Share,
      ...(holderData.error ? { reason: holderData.error } : {}),
    } satisfies Distribution,
    categories,
    score: hasEnoughCoverage ? score : null,
    classification: classifyScore(score, hasEnoughCoverage),
    availableWeight: Math.round(availableWeight),
    totalWeight: Math.round(totalWeight),
    coveragePercent: Math.round(coverage * 100),
    sources,
    /*
     * Display-only passthrough. Every value here is either taken straight from
     * the overview the caller already built, or read with the market
     * provider's own aggregate helpers — the same ones the rules use. Nothing
     * is recomputed here, and nothing here is an input to the score.
     */
    market: {
      status: validationOf(input.marketData).status,
      confidence: validationOf(input.marketData).confidence,
      contextualQuote: contextualQuote(input.marketData),
      reason: validationOf(input.marketData).price.reason,
      changeState: validationOf(input.marketData).change24h.status,
      capState: validationOf(input.marketData).marketCap.status,
      fdvState: validationOf(input.marketData).fdv.status,
      history: validationOf(input.marketData).history,
      historyStatus: validationOf(input.marketData).historyCheck.status,
      historyReason: validationOf(input.marketData).historyCheck.reason,
      available: input.marketData.available,
      priceUsd: spotPrice(input.marketData),
      priceChange24hPercent: priceChange24h(input.marketData),
      marketCapUsd: marketCap(input.marketData),
      fullyDilutedUsd: input.mintInfo.supplyIsMeaningful
        ? fullyDilutedValuation(input.marketData, input.mintInfo.supplyUi)
        : null,
      liquidityUsd: input.marketData.available ? totalLiquidity(input.marketData) : null,
      volume24hUsd: input.marketData.available ? totalVolume24h(input.marketData) : null,
      poolCount: input.marketData.pairs.length,
      poolAddress: canonicalPair(input.marketData)?.pairAddress ?? null,
      poolDex: canonicalPair(input.marketData)?.dexId ?? null,
    },
    /*
     * Display-only passthrough, exactly like `market` above. It is carried
     * through the engine so the report is assembled in one place, and it is
     * read by no rule — adding it changed no score, no severity and no
     * verdict.
     */
    liquiditySafety: input.liquiditySafety,
    diagnostics: validationOf(input.marketData),
    generatedAt: new Date().toISOString(),
    elapsedMs,
    warnings,
  };
}
