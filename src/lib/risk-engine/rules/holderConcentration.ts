import type { RiskSignal, Severity } from "../types";
import type { AnalysisInput } from "../input";

const TOP1_MAX_POINTS = 15;
const TOP10_MAX_POINTS = 15;

function tier(pct: number, thresholds: [number, Severity, number][]): [Severity, number] {
  for (const [limit, severity, points] of thresholds) {
    if (pct < limit) return [severity, points];
  }
  const last = thresholds[thresholds.length - 1];
  return [last[1], last[2]];
}

const CAVEAT =
  "Computed from the largest raw on-chain token accounts, which can include liquidity-pool vaults, exchange wallets, or program-controlled accounts rather than individual holders. Check the evidence panel before treating this as a standalone red flag.";

/** Concentration held by the single largest token account. */
export function topHolderRule({ holderData }: AnalysisInput): RiskSignal {
  if (!holderData.available) {
    return unavailableSignal(
      "top-holder",
      "Largest Holder Concentration",
      TOP1_MAX_POINTS,
      holderData.error,
    );
  }

  const top1 = (holderData.topAccountShares[0] ?? 0) * 100;
  const [severity, points] = tier(top1, [
    [10, "none", 0],
    [20, "low", 5],
    [40, "medium", 10],
    [70, "high", 13],
    [Infinity, "critical", TOP1_MAX_POINTS],
  ]);

  return {
    id: "top-holder",
    label: "Largest Holder Concentration",
    category: "Holders",
    status: "ok",
    observedValue: `${top1.toFixed(2)}% of supply in the single largest account`,
    severity,
    maxPoints: TOP1_MAX_POINTS,
    points,
    explanation: `The single largest token account holds ${top1.toFixed(2)}% of total supply. ${CAVEAT}`,
    evidence: { top1SharePct: top1, topAccountShares: holderData.topAccountShares.slice(0, 5) },
  };
}

/** Concentration held by the ten largest token accounts combined. */
export function top10HoldersRule({ holderData }: AnalysisInput): RiskSignal {
  if (!holderData.available) {
    return unavailableSignal(
      "top10-holders",
      "Top 10 Holder Concentration",
      TOP10_MAX_POINTS,
      holderData.error,
    );
  }

  const top10 = holderData.topAccountShares.slice(0, 10).reduce((sum, s) => sum + s, 0) * 100;
  const [severity, points] = tier(top10, [
    [20, "none", 0],
    [40, "low", 5],
    [60, "medium", 10],
    [85, "high", 13],
    [Infinity, "critical", TOP10_MAX_POINTS],
  ]);

  return {
    id: "top10-holders",
    label: "Top 10 Holder Concentration",
    category: "Holders",
    status: "ok",
    observedValue: `${top10.toFixed(2)}% of supply across the 10 largest accounts`,
    severity,
    maxPoints: TOP10_MAX_POINTS,
    points,
    explanation: `The ten largest token accounts together hold ${top10.toFixed(2)}% of total supply. ${CAVEAT}`,
    evidence: { top10SharePct: top10, topAccountShares: holderData.topAccountShares.slice(0, 10) },
  };
}

function unavailableSignal(
  id: string,
  label: string,
  maxPoints: number,
  error: string | undefined,
): RiskSignal {
  return {
    id,
    label,
    category: "Holders",
    status: "unavailable",
    observedValue: "Unavailable",
    severity: "none",
    maxPoints,
    points: 0,
    explanation:
      "Holder data could not be retrieved from the configured Solana RPC endpoint (getTokenLargestAccounts is heavily rate-limited on the public endpoint). Configure SOLANA_RPC_URL with a dedicated free-tier RPC provider for this signal.",
    evidence: error ? { error } : {},
  };
}
