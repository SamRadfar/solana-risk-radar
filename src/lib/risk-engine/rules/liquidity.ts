import type { RiskSignal } from "../types";
import type { AnalysisInput } from "../input";
import { formatUsd } from "../../format";

const MAX_POINTS = 15;

/**
 * Total on-chain liquidity across all indexed DEX pools. Low or absent
 * liquidity means large trades move price sharply and exiting a position
 * may not be possible at a fair price.
 */
export function liquidityRule({ marketData }: AnalysisInput): RiskSignal {
  if (!marketData.available) {
    return {
      id: "liquidity",
      label: "Market Liquidity",
      category: "Liquidity",
      status: "unavailable",
      observedValue: "Unavailable",
      severity: "none",
      maxPoints: MAX_POINTS,
      points: 0,
      explanation: `Market data could not be retrieved from DexScreener. ${marketData.error ?? ""}`.trim(),
      evidence: {},
    };
  }

  if (marketData.pairs.length === 0) {
    return {
      id: "liquidity",
      label: "Market Liquidity",
      category: "Liquidity",
      status: "ok",
      observedValue: "No DEX pools found",
      severity: "critical",
      maxPoints: MAX_POINTS,
      points: MAX_POINTS,
      explanation:
        "No liquidity pool for this token was found on any DEX indexed by DexScreener. The token may not be listed on any exchange, may be brand new, or may be untradeable.",
      evidence: { pairsFound: 0 },
    };
  }

  const totalLiquidity = marketData.pairs.reduce((sum, p) => sum + p.liquidityUsd, 0);

  const [severity, points] =
    totalLiquidity < 1_000
      ? (["critical", MAX_POINTS] as const)
      : totalLiquidity < 10_000
        ? (["high", 11] as const)
        : totalLiquidity < 50_000
          ? (["medium", 7] as const)
          : totalLiquidity < 200_000
            ? (["low", 3] as const)
            : (["none", 0] as const);

  return {
    id: "liquidity",
    label: "Market Liquidity",
    category: "Liquidity",
    status: "ok",
    observedValue: `${formatUsd(totalLiquidity)} across ${marketData.pairs.length} pool${marketData.pairs.length === 1 ? "" : "s"}`,
    severity,
    maxPoints: MAX_POINTS,
    points,
    explanation: `Total on-chain liquidity across all detected pools is ${formatUsd(totalLiquidity)}. ${
      severity === "none"
        ? "This is a healthy liquidity level for typical trade sizes."
        : "Thin liquidity means trades can cause significant price impact and large positions may be difficult to exit."
    }`,
    evidence: {
      totalLiquidityUsd: totalLiquidity,
      pools: marketData.pairs.map((p) => ({ dex: p.dexId, liquidityUsd: p.liquidityUsd })),
    },
  };
}
