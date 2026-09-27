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

const MINT_AGE_BANDS: readonly Band[] = [
  [365, "none"],
  [90, "low"],
  [30, "medium"],
  [7, "high"],
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

/**
 * Age of the mint account itself, from its transaction history.
 *
 * A pool can be created long after a mint, so this catches a different case
 * from pool age: a token minted minutes before its pool opened.
 */
export function mintAgeRule({ tokenAge }: AnalysisInput): RiskSignal {
  const ID = "mint-age";
  const LABEL = "Token Age";
  const METRIC = "Age of the mint's earliest transaction";
  const MAX_POINTS = 10;

  if (!tokenAge.available || tokenAge.ageDays === null) {
    return unavailable({
      id: ID,
      label: LABEL,
      category: CATEGORY,
      metric: METRIC,
      maxPoints: MAX_POINTS,
      reason: `The mint's transaction history could not be read. ${tokenAge.error ?? ""}`.trim(),
    });
  }

  /**
   * If paging hit its limit before reaching the start of history, the oldest
   * signature we saw is simply the oldest we bothered to fetch — it says
   * nothing about when the mint was created. A heavily traded token can push
   * thousands of signatures through in an hour, so scoring that as "minutes
   * old" would brand the most established tokens on Solana as brand new.
   *
   * Age is genuinely unknown here, and the honest answer is to say so rather
   * than to guess. This costs nothing where it matters: a newly created token
   * has a short history and resolves exactly.
   */
  if (tokenAge.isLowerBound) {
    return unavailable({
      id: ID,
      label: LABEL,
      category: CATEGORY,
      metric: METRIC,
      maxPoints: MAX_POINTS,
      reason: `This mint has more transaction history than can be scanned in one request (over ${tokenAge.signaturesScanned.toLocaleString("en-US")} signatures), so its creation date cannot be established. A token this active is not newly created, but its exact age is unknown. Pool Age covers market maturity independently.`,
      evidence: [
        { label: "Signatures scanned", value: String(tokenAge.signaturesScanned) },
        { label: "Reached start of history", value: "no" },
      ],
    });
  }

  const ageDays = tokenAge.ageDays;
  const severity = classifyDescending(ageDays, MINT_AGE_BANDS);

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
        ? `The mint's first transaction was ${duration(ageDays)} ago. This is an established token with a long on-chain history.`
        : `The mint's first transaction was ${duration(ageDays)} ago. Recently created tokens have no track record, and a short gap between minting and launch is characteristic of disposable tokens created in bulk.`,
    evidence: [
      ...(tokenAge.oldestSignatureAt !== null
        ? [
            {
              label: "Earliest transaction",
              value: new Date(tokenAge.oldestSignatureAt).toISOString(),
            },
          ]
        : []),
      { label: "Signatures scanned", value: String(tokenAge.signaturesScanned) },
      { label: "Precision", value: "Exact — full history scanned" },
    ],
  });
}
