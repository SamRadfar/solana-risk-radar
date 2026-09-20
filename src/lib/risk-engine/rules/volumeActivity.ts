import type { RiskSignal } from "../types";
import type { AnalysisInput } from "../input";
import { formatUsd } from "../../format";

const MAX_POINTS = 10;

/**
 * Compares 24h trading volume to total liquidity. Near-zero volume on a
 * token with an active pool suggests a dead / abandoned market. Extremely
 * high turnover (volume far exceeding liquidity) can indicate wash trading
 * used to fabricate the appearance of activity.
 */
export function volumeActivityRule({ marketData }: AnalysisInput): RiskSignal {
  if (!marketData.available || marketData.pairs.length === 0) {
    return {
      id: "volume-activity",
      label: "Trading Activity",
      category: "Market Activity",
      status: "unavailable",
      observedValue: "Unavailable",
      severity: "none",
      maxPoints: MAX_POINTS,
      points: 0,
      explanation: marketData.available
        ? "No liquidity pool was found, so trading activity cannot be assessed."
        : `Market data could not be retrieved. ${marketData.error ?? ""}`.trim(),
      evidence: {},
    };
  }

  const liquidity = marketData.pairs.reduce((sum, p) => sum + p.liquidityUsd, 0);
  const volume24h = marketData.pairs.reduce((sum, p) => sum + p.volume24hUsd, 0);

  if (liquidity <= 0) {
    return {
      id: "volume-activity",
      label: "Trading Activity",
      category: "Market Activity",
      status: "unavailable",
      observedValue: "Unavailable",
      severity: "none",
      maxPoints: MAX_POINTS,
      points: 0,
      explanation: "Turnover cannot be computed because reported liquidity is zero.",
      evidence: { volume24hUsd: volume24h },
    };
  }

  const turnover = volume24h / liquidity;

  let severity: RiskSignal["severity"] = "none";
  let points = 0;
  let note = "Trading activity is within a normal range relative to liquidity.";

  if (volume24h === 0) {
    severity = "medium";
    points = 5;
    note = "No trading volume in the last 24 hours despite an active pool — the market may be dead or abandoned.";
  } else if (turnover > 10) {
    severity = "medium";
    points = 6;
    note = `24h volume is ${turnover.toFixed(1)}x total liquidity, an unusually high turnover ratio that can indicate wash trading.`;
  } else if (turnover > 5) {
    severity = "low";
    points = 3;
    note = `24h volume is ${turnover.toFixed(1)}x total liquidity, a high but not extreme turnover ratio.`;
  }

  return {
    id: "volume-activity",
    label: "Trading Activity",
    category: "Market Activity",
    status: "ok",
    observedValue: `${formatUsd(volume24h)} 24h volume (${turnover.toFixed(2)}x liquidity)`,
    severity,
    maxPoints: MAX_POINTS,
    points,
    explanation: note,
    evidence: { volume24hUsd: volume24h, liquidityUsd: liquidity, turnoverRatio: turnover },
  };
}
