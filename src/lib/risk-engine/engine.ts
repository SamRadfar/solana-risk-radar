import type { AnalysisInput, RiskRule } from "./input";
import {
  RISK_CATEGORIES,
  type CategoryScore,
  type DataSourceStatus,
  type Distribution,
  type RiskClassification,
  type RiskReport,
  type RiskSignal,
  type TokenOverview,
} from "./types";
import {
  freezeAuthorityRule,
  metadataMutabilityRule,
  mintAuthorityRule,
  tokenExtensionsRule,
} from "./rules/authorities";
import { top10HoldersRule, topHolderRule } from "./rules/holders";
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
import { mintAgeRule, poolMaturityRule } from "./rules/maturity";

/**
 * The deterministic scoring engine.
 *
 * Every rule is a pure function of fetched data. Given identical inputs the
 * engine always produces an identical score — there is no model, no sampling
 * and no randomness anywhere in this path. The engine's only jobs are to run
 * the rules, aggregate their points, and be honest about what it could not
 * measure.
 *
 * Scoring: each rule charges a fraction of its weight according to the severity
 * it assigned (see `helpers.ts`). The final score is the charged points as a
 * percentage of the weight of the rules that could actually be evaluated.
 * Normalising over *available* weight rather than total weight is what keeps a
 * partially-measurable token comparable to a fully-measurable one, instead of
 * scoring artificially safe just because data was missing.
 */

export const RULES: RiskRule[] = [
  // Authorities — who retains control over the token after launch.
  mintAuthorityRule,
  freezeAuthorityRule,
  tokenExtensionsRule,
  metadataMutabilityRule,
  // Holders — how concentrated the sellable supply is.
  topHolderRule,
  top10HoldersRule,
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
  mintAgeRule,
];

/**
 * Below this share of total rule weight, a score would be drawn from too little
 * evidence to mean anything, so the report reports "Insufficient Data" instead
 * of a confident-looking number.
 */
const MIN_COVERAGE_FOR_SCORE = 0.4;

const BANDS: readonly [max: number, classification: RiskClassification][] = [
  [15, "Low Risk Signals"],
  [35, "Moderate Risk Signals"],
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
      percent: maxPoints > 0 ? Math.round((points / maxPoints) * 100) : null,
      signalCount: inCategory.length,
    };
  });
}

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

  const totalWeight = signals.reduce((sum, s) => sum + s.maxPoints, 0);
  const availableWeight = signals
    .filter((s) => s.status === "ok")
    .reduce((sum, s) => sum + s.maxPoints, 0);
  const chargedPoints = signals.reduce((sum, s) => sum + s.points, 0);

  const coverage = totalWeight > 0 ? availableWeight / totalWeight : 0;
  const hasEnoughCoverage = coverage >= MIN_COVERAGE_FOR_SCORE;
  const score =
    availableWeight > 0 ? Math.round((chargedPoints / availableWeight) * 100) : null;

  const warnings: string[] = [];
  const unavailable = signals.filter((s) => s.status === "unavailable");

  if (unavailable.length > 0) {
    warnings.push(
      `${unavailable.length} of ${signals.length} signals could not be measured (${unavailable
        .map((s) => s.label)
        .join(", ")}). The score is normalised over only the signals that were measurable, so it is not diluted by missing data.`,
    );
  }
  if (!hasEnoughCoverage) {
    warnings.push(
      `Only ${Math.round(coverage * 100)}% of the total signal weight could be evaluated — too little to produce a meaningful score. Treat the individual signals below as the result, not the overall number.`,
    );
  }

  const { holderData } = input;

  return {
    overview,
    signals,
    distribution: {
      available: holderData.available,
      holders: holderData.holders.slice(0, 20).map((holder) => ({
        owner: holder.owner,
        tokenAccount: holder.tokenAccount,
        amountUi: holder.amountUi,
        share: holder.share,
        kind: holder.kind,
        label: holder.label,
      })),
      pooledShare: holderData.pooledShare,
      burnedShare: holderData.burnedShare,
      topHolderShare: holderData.topHolderShare,
      top10Share: holderData.top10Share,
      ...(holderData.error ? { reason: holderData.error } : {}),
    } satisfies Distribution,
    categories: summariseCategories(signals),
    score: hasEnoughCoverage ? score : null,
    classification: classifyScore(score, hasEnoughCoverage),
    availableWeight: Math.round(availableWeight),
    totalWeight: Math.round(totalWeight),
    coveragePercent: Math.round(coverage * 100),
    sources,
    generatedAt: new Date().toISOString(),
    elapsedMs,
    warnings,
  };
}
