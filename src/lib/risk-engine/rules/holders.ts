import type { AnalysisInput } from "../input";
import type { Evidence, RiskSignal } from "../types";
import { classify, pct, signal, unavailable, type Band } from "../helpers";
import { explorerAccountUrl } from "../../solana/knownAddresses";

const CATEGORY = "Holders" as const;

/**
 * Concentration is measured over *circulating* supply and counts only holders
 * who could actually sell. Pool vaults and burn addresses are excluded — see
 * `lib/solana/holders.ts` for how each holder is classified.
 *
 * The two rules here deliberately measure different failure modes, because the
 * obvious pair (top-1 and top-10) does not. Across real mainnet tokens top-1
 * and top-10 correlate at r = 0.92: top-10 *contains* top-1, so scoring both
 * charges the same wallet twice and calls it two independent findings. TRUMP is
 * the clearest case — one wallet holds 72.7% and the top ten hold 87.9%, which
 * the old pairing reported as both "critical single holder" and "critical
 * systemic distribution", when the next nine wallets actually hold only 15.2%.
 *
 * Scoring the marginal share instead (holders 2–10, excluding the largest)
 * drops that correlation to r = 0.07, so the two signals answer genuinely
 * separate questions:
 *
 *   Largest Holder  — can one actor crash the price or exit ahead of everyone?
 *   Holder Spread   — is there a cluster behind them that could act together?
 *
 * The familiar top-10 figure is still reported, in both rules' evidence and in
 * the distribution panel. It is shown, just not charged twice.
 */

const TOP1_BANDS: readonly Band[] = [
  [0.05, "none"],
  [0.1, "low"],
  [0.2, "medium"],
  [0.35, "high"],
  [Infinity, "critical"],
];

/**
 * Thresholds for the nine holders behind the largest, calibrated against real
 * tokens rather than reused from the top-1 scale. Nine wallets sharing 30% of
 * supply (~3.3% each) is ordinary for a widely held token; nine wallets sharing
 * 65% is a bloc that can move the market together.
 */
const NEXT9_BANDS: readonly Band[] = [
  [0.2, "none"],
  [0.35, "low"],
  [0.5, "medium"],
  [0.65, "high"],
  [Infinity, "critical"],
];

function holderEvidence({ holderData }: AnalysisInput): Evidence[] {
  const evidence: Evidence[] = [
    { label: "Accounts examined", value: String(holderData.holders.length) },
    {
      label: "Largest holder",
      value: holderData.topHolderShare !== null ? pct(holderData.topHolderShare) : "—",
    },
    {
      label: "Holders 2–10 combined",
      value: holderData.next9Share !== null ? pct(holderData.next9Share) : "—",
    },
    {
      label: "Top 10 combined",
      value: holderData.top10Share !== null ? pct(holderData.top10Share) : "—",
    },
    { label: "Held in DEX pools", value: pct(holderData.pooledShare) },
    { label: "Provably burned", value: pct(holderData.burnedShare) },
  ];

  for (const holder of holderData.holders.slice(0, 5)) {
    const kind =
      holder.label ??
      (holder.kind === "wallet"
        ? "wallet"
        : holder.kind.replace(/^\w/, (c) => c.toUpperCase()));
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

/** Single-actor risk: the largest holder that could sell. */
export function topHolderRule(input: AnalysisInput): RiskSignal {
  const { holderData } = input;
  const ID = "top-holder";
  const LABEL = "Largest Holder";
  const METRIC = "Largest single holder's share of circulating supply";
  const MAX_POINTS = 18;

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

/** Coordinated risk: the cluster sitting behind the largest holder. */
export function holderSpreadRule(input: AnalysisInput): RiskSignal {
  const { holderData } = input;
  const ID = "holder-spread";
  const LABEL = "Holder Spread";
  const METRIC = "Combined share of the 2nd–10th largest holders";
  const MAX_POINTS = 10;

  if (!holderData.available || holderData.next9Share === null) {
    return unavailable({
      id: ID,
      label: LABEL,
      category: CATEGORY,
      metric: METRIC,
      maxPoints: MAX_POINTS,
      reason: UNAVAILABLE_REASON(holderData.error),
    });
  }

  const share = holderData.next9Share;
  const severity = classify(share, NEXT9_BANDS);
  const top10 = holderData.top10Share;

  const context =
    top10 !== null
      ? ` Together with the largest holder they hold ${pct(top10)}; the largest holder is scored separately so that one wallet is not counted twice.`
      : "";

  return signal({
    id: ID,
    label: LABEL,
    category: CATEGORY,
    metric: METRIC,
    maxPoints: MAX_POINTS,
    severity,
    observedValue: `${pct(share)} held by holders 2–10`,
    explanation:
      severity === "none"
        ? `The nine holders behind the largest one hold ${pct(share)} of circulating supply between them — no significant bloc sits behind the top holder.${context}`
        : `The nine holders behind the largest one hold ${pct(share)} of circulating supply between them. A cluster this size could move the market together, whether by coordinating or simply by reacting to the same news at the same time.${context}`,
    evidence: holderEvidence(input),
  });
}
