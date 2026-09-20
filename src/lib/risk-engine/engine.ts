import type { AnalysisInput } from "./input";
import type { RiskClassification, RiskReport, TokenOverview } from "./types";
import { mintAuthorityRule } from "./rules/mintAuthority";
import { freezeAuthorityRule } from "./rules/freezeAuthority";
import { topHolderRule, top10HoldersRule } from "./rules/holderConcentration";
import { liquidityRule } from "./rules/liquidity";
import { poolMaturityRule } from "./rules/poolMaturity";
import { volumeActivityRule } from "./rules/volumeActivity";

const RULES = [
  mintAuthorityRule,
  freezeAuthorityRule,
  topHolderRule,
  top10HoldersRule,
  liquidityRule,
  poolMaturityRule,
  volumeActivityRule,
];

/** Fraction of total rule weight that must be available before we trust a score at all. */
const MIN_CONFIDENT_WEIGHT_FRACTION = 0.4;

function classify(score: number | null, confident: boolean): RiskClassification {
  if (score === null || !confident) return "Insufficient Data";
  if (score < 20) return "Low Risk Signals";
  if (score < 45) return "Moderate Risk Signals";
  if (score < 70) return "Elevated Risk Signals";
  return "High Risk Signals";
}

export function buildRiskReport(input: AnalysisInput, overview: TokenOverview): RiskReport {
  const signals = RULES.map((rule) => rule(input));

  const totalWeight = signals.reduce((sum, s) => sum + s.maxPoints, 0);
  const availableWeight = signals
    .filter((s) => s.status === "ok")
    .reduce((sum, s) => sum + s.maxPoints, 0);
  const rawPoints = signals.reduce((sum, s) => sum + s.points, 0);

  const confident = totalWeight > 0 && availableWeight / totalWeight >= MIN_CONFIDENT_WEIGHT_FRACTION;
  const score = availableWeight > 0 ? Math.round((rawPoints / availableWeight) * 100) : null;

  const warnings: string[] = [];
  const unavailable = signals.filter((s) => s.status === "unavailable");
  if (unavailable.length > 0) {
    warnings.push(
      `${unavailable.length} of ${signals.length} risk signals could not be computed (${unavailable
        .map((s) => s.label)
        .join(", ")}). The score below is normalized over only the available signals.`,
    );
  }
  if (!confident) {
    warnings.push(
      "Too little data was available to produce a confident risk score. Treat this result as incomplete.",
    );
  }

  return {
    overview,
    signals,
    score,
    classification: classify(score, confident),
    availableWeight,
    totalWeight,
    generatedAt: new Date().toISOString(),
    warnings,
  };
}
