import type { AnalysisInput } from "../input";
import type { Evidence, RiskSignal } from "../types";
import { classify, pct, signal, unavailable, type Band } from "../helpers";
import { explorerAccountUrl } from "../../solana/knownAddresses";

const CATEGORY = "Holders" as const;

/**
 * Concentration is measured over *circulating* supply and counts only holders
 * who could actually sell. Pool vaults and burn addresses are excluded — see
 * `lib/solana/holders.ts` for how each holder is classified.
 */

const TOP1_BANDS: readonly Band[] = [
  [0.05, "none"],
  [0.1, "low"],
  [0.2, "medium"],
  [0.35, "high"],
  [Infinity, "critical"],
];

const TOP10_BANDS: readonly Band[] = [
  [0.15, "none"],
  [0.3, "low"],
  [0.5, "medium"],
  [0.7, "high"],
  [Infinity, "critical"],
];

function holderEvidence({ holderData }: AnalysisInput): Evidence[] {
  const evidence: Evidence[] = [
    { label: "Accounts examined", value: String(holderData.holders.length) },
    { label: "Held in DEX pools", value: pct(holderData.pooledShare) },
    { label: "Provably burned", value: pct(holderData.burnedShare) },
  ];

  for (const holder of holderData.holders.slice(0, 5)) {
    const kind =
      holder.label ??
      (holder.kind === "wallet" ? "wallet" : holder.kind.replace(/^\w/, (c) => c.toUpperCase()));
    evidence.push({
      label: `${pct(holder.share)} — ${kind}`,
      value: holder.owner ?? holder.tokenAccount,
      href: explorerAccountUrl(holder.owner ?? holder.tokenAccount),
    });
  }

  return evidence;
}

const UNAVAILABLE_REASON = (error: string | undefined) =>
  `Holder data could not be retrieved. ${
    error ?? "The Solana RPC endpoint did not return the token's largest accounts."
  }`;

/** Share held by the single largest account that could sell. */
export function topHolderRule(input: AnalysisInput): RiskSignal {
  const { holderData } = input;
  const ID = "top-holder";
  const LABEL = "Largest Holder";
  const METRIC = "Largest single holder's share of circulating supply";
  const MAX_POINTS = 16;

  if (!holderData.available || holderData.topHolderShare === null) {
    return unavailable({
      id: ID,
      label: LABEL,
      category: CATEGORY,
      metric: METRIC,
      maxPoints: MAX_POINTS,
      reason: UNAVAILABLE_REASON(holderData.error),
    });
  }

  const share = holderData.topHolderShare;
  const largest = holderData.holders.find((h) => h.kind !== "pool" && h.kind !== "burn");
  const severity = classify(share, TOP1_BANDS);

  const descriptor =
    largest?.kind === "custodian"
      ? ` The largest such holder is a known exchange wallet${largest.label ? ` (${largest.label})` : ""}, which custodies many customers' balances rather than belonging to one person.`
      : largest?.kind === "contract"
        ? " The largest such holder is a program-controlled account, which may be a vesting, staking or escrow contract rather than an individual."
        : "";

  return signal({
    id: ID,
    label: LABEL,
    category: CATEGORY,
    metric: METRIC,
    maxPoints: MAX_POINTS,
    severity,
    observedValue: `${pct(share)} of circulating supply`,
    explanation:
      severity === "none"
        ? `The largest sellable holder controls ${pct(share)} of circulating supply — a well-distributed position that no single actor can use to move the market alone.${descriptor}`
        : `The largest sellable holder controls ${pct(share)} of circulating supply. A position this size can move the price sharply if it is sold, and the holder can exit before most others react.${descriptor}`,
    evidence: holderEvidence(input),
  });
}

/** Combined share of the ten largest accounts that could sell. */
export function top10HoldersRule(input: AnalysisInput): RiskSignal {
  const { holderData } = input;
  const ID = "top10-holders";
  const LABEL = "Top 10 Holders";
  const METRIC = "Ten largest holders' combined share of circulating supply";
  const MAX_POINTS = 14;

  if (!holderData.available || holderData.top10Share === null) {
    return unavailable({
      id: ID,
      label: LABEL,
      category: CATEGORY,
      metric: METRIC,
      maxPoints: MAX_POINTS,
      reason: UNAVAILABLE_REASON(holderData.error),
    });
  }

  const share = holderData.top10Share;
  const severity = classify(share, TOP10_BANDS);

  return signal({
    id: ID,
    label: LABEL,
    category: CATEGORY,
    metric: METRIC,
    maxPoints: MAX_POINTS,
    severity,
    observedValue: `${pct(share)} of circulating supply`,
    explanation:
      severity === "none"
        ? `The ten largest sellable holders together control ${pct(share)} of circulating supply, which indicates broad distribution.`
        : `The ten largest sellable holders together control ${pct(share)} of circulating supply. Coordinated or panicked selling by a small group of wallets could overwhelm available liquidity. Liquidity-pool vaults and burned supply are already excluded from this figure.`,
    evidence: holderEvidence(input),
  });
}
