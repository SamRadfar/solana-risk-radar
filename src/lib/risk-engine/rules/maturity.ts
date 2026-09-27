import { pairsByLiquidity } from "../../market/access";
import type { AnalysisInput } from "../input";
import type { RiskSignal } from "../types";
import {
  classifyDescending,
  duration,
  signal,
  unavailable,
  type Band,
} from "../helpers";

const CATEGORY = "Maturity" as const;

/** Descending bands: more days is safer. */
const POOL_AGE_BANDS: readonly Band[] = [
  [180, "none"],
  [30, "low"],
  [7, "medium"],
  [1, "high"],
  [-Infinity, "critical"],
];

/**
 * Age of the token's oldest liquidity pool. Very young pools correlate
 * strongly with rug-pull risk: there has been no time for the market to
 * stress-test the token or for the deployer's behaviour to be observed.
 */
export function poolMaturityRule({ marketData }: AnalysisInput): RiskSignal {
  const ID = "pool-maturity";
  const LABEL = "Pool Age";
  const METRIC = "Age of the oldest liquidity pool";
  const MAX_POINTS = 12;

  const timestamps = pairsByLiquidity(marketData)
    .map((pair) => pair.pairCreatedAt)
    .filter((value): value is number => typeof value === "number" && value > 0);

  if (!marketData.available || timestamps.length === 0) {
    return unavailable({
      id: ID,
      label: LABEL,
      category: CATEGORY,
      metric: METRIC,
      maxPoints: MAX_POINTS,
      reason: marketData.available
        ? "No independently corroborated pool creation timestamp is available."
        : `Independent market measurement is unavailable. ${marketData.error ?? ""}`.trim(),
    });
  }

  const oldest = Math.min(...timestamps);
  const ageDays = ((marketData.validation?.evaluatedAt ?? oldest) - oldest) / (1000 * 60 * 60 * 24);
  const severity = classifyDescending(ageDays, POOL_AGE_BANDS);

  return signal({
    id: ID,
    label: LABEL,
    category: CATEGORY,
    metric: METRIC,
    maxPoints: MAX_POINTS,
    severity,
    observedValue: `${duration(ageDays)} old`,
    explanation:
      severity === "none"
        ? `The oldest liquidity pool was created ${duration(ageDays)} ago. The market has had substantial time to mature and the token has survived multiple market conditions.`
        : `The oldest liquidity pool was created only ${duration(ageDays)} ago. New pools carry elevated early-stage risk: there has been no time to observe whether liquidity stays funded or whether the deployer behaves as promised. The large majority of rug-pulls happen within days of launch.`,
    evidence: [
      { label: "Oldest pool created", value: new Date(oldest).toISOString() },
      { label: "Age", value: duration(ageDays) },
      { label: "Pools with a known age", value: String(timestamps.length) },
    ],
  });
}
