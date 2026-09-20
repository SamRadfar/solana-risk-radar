import type { RiskSignal } from "../types";
import type { AnalysisInput } from "../input";

const MAX_POINTS = 10;

/**
 * Age of the token's oldest known liquidity pool. Very young pools correlate
 * strongly with rug-pull risk: there has been no time for the market to
 * stress-test the token's contract or the deployer's behavior.
 */
export function poolMaturityRule({ marketData }: AnalysisInput): RiskSignal {
  const timestamps = marketData.pairs
    .map((p) => p.pairCreatedAt)
    .filter((t): t is number => typeof t === "number" && t > 0);

  if (!marketData.available || timestamps.length === 0) {
    return {
      id: "pool-maturity",
      label: "Pool Maturity",
      category: "Liquidity",
      status: "unavailable",
      observedValue: "Unavailable",
      severity: "none",
      maxPoints: MAX_POINTS,
      points: 0,
      explanation: marketData.available
        ? "No pool creation timestamp is available (no liquidity pool was found)."
        : `Market data could not be retrieved. ${marketData.error ?? ""}`.trim(),
      evidence: {},
    };
  }

  const oldest = Math.min(...timestamps);
  const ageHours = (Date.now() - oldest) / (1000 * 60 * 60);

  const [severity, points] =
    ageHours < 1
      ? (["critical", MAX_POINTS] as const)
      : ageHours < 24
        ? (["high", 7] as const)
        : ageHours < 24 * 7
          ? (["medium", 4] as const)
          : ageHours < 24 * 30
            ? (["low", 2] as const)
            : (["none", 0] as const);

  const ageLabel =
    ageHours < 24
      ? `${ageHours.toFixed(1)} hours`
      : ageHours < 24 * 30
        ? `${(ageHours / 24).toFixed(1)} days`
        : `${(ageHours / (24 * 30)).toFixed(1)} months`;

  return {
    id: "pool-maturity",
    label: "Pool Maturity",
    category: "Liquidity",
    status: "ok",
    observedValue: `Oldest pool is ${ageLabel} old`,
    severity,
    maxPoints: MAX_POINTS,
    points,
    explanation: `The oldest detected liquidity pool was created ${ageLabel} ago. ${
      severity === "none"
        ? "The market has had meaningful time to mature."
        : "Very new pools have had little time to be stress-tested and carry elevated early-stage risk."
    }`,
    evidence: { oldestPairCreatedAt: new Date(oldest).toISOString(), ageHours },
  };
}
