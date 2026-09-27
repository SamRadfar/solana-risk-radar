import type { AnalysisInput } from "../input";
import type { RiskSignal, Severity } from "../types";
import { classify, pct, signal, unavailable, usd, type Band } from "../helpers";
import {
  validationOf,
  priceChange24h,
  totalVolume24h,
} from "../../market/access";
import type { SubsetCoverage } from "../../market/types";

const CATEGORY = "Market Activity" as const;

const NO_MARKET_DATA = (error: string | undefined) =>
  `Independently validated market data is unavailable. ${error ?? ""}`.trim();

/** Disclose which corroborated pools a subset metric was measured on. */
function coverageEvidence(c: SubsetCoverage) {
  return [
    { label: "Pools measured", value: `${c.poolsMeasured} of ${c.poolsCorroborated} corroborated pools` },
    { label: "Share of corroborated reserves", value: pct(c.liquidityShare, 1) },
    ...(c.excluded.length ? [{ label: "Excluded for this metric", value: c.excluded.slice(0, 3).map((e) => `${e.pairAddress.slice(0, 8)}… (${e.reason})`).join("; ") + (c.excluded.length > 3 ? `; +${c.excluded.length - 3} more` : "") }] : []),
  ];
}

/**
 * 24-hour volume relative to liquidity (turnover).
 *
 * This is deliberately two-sided. Near-zero turnover means an abandoned market
 * that cannot be exited; extreme turnover is a hallmark of wash trading used to
 * manufacture the appearance of demand. Both are risks, for opposite reasons.
 */
export function tradingActivityRule({ marketData }: AnalysisInput): RiskSignal {
  const ID = "trading-activity";
  const LABEL = "Trading Activity";
  const METRIC = "24h volume relative to liquidity";
  const MAX_POINTS = 10;

  const subset = validationOf(marketData).volumeSubset;
  if (!marketData.available || totalVolume24h(marketData) === null || subset === null) {
    return unavailable({
      id: ID,
      label: LABEL,
      category: CATEGORY,
      metric: METRIC,
      maxPoints: MAX_POINTS,
      reason: marketData.available
        ? `Independently validated 24h volume was unavailable. ${validationOf(marketData).volume24h.reason}.`
        : NO_MARKET_DATA(marketData.error),
    });
  }

  // Volume and liquidity come from the SAME measured pools, never mixed sets.
  const liquidity = subset.liquidityUsd;
  const volume = totalVolume24h(marketData);

  if (volume === null || liquidity <= 0) {
    return unavailable({
      id: ID,
      label: LABEL,
      category: CATEGORY,
      metric: METRIC,
      maxPoints: MAX_POINTS,
      reason: "Turnover cannot be computed because reported liquidity is zero.",
      evidence: [{ label: "24h volume", value: usd(volume ?? 0) }],
    });
  }

  const turnover = volume / liquidity;

  let severity: Severity;
  let explanation: string;

  if (volume === 0) {
    severity = "high";
    explanation =
      "There was no trading volume at all in the last 24 hours despite a funded pool existing. The market appears dead or abandoned, and there may be no counterparty available when you want to sell.";
  } else if (turnover < 0.01) {
    severity = "high";
    explanation = `24h volume is only ${pct(turnover)} of pooled liquidity. Trading is effectively dormant, so exiting a position may take a long time or move the price substantially.`;
  } else if (turnover < 0.05) {
    severity = "medium";
    explanation = `24h volume is ${pct(turnover)} of pooled liquidity — unusually quiet. There is a market, but it is thin enough that a sizeable sell would struggle to find buyers.`;
  } else if (turnover > 30) {
    severity = "high";
    explanation = `24h volume is ${turnover.toFixed(1)}x total pooled liquidity. Turnover this extreme is rarely produced by organic demand and is a common signature of wash trading used to fabricate activity.`;
  } else if (turnover > 10) {
    severity = "medium";
    explanation = `24h volume is ${turnover.toFixed(1)}x total pooled liquidity. That is a very high turnover ratio, which can reflect genuine momentum but is also consistent with inflated or artificial volume.`;
  } else {
    severity = "none";
    explanation = `24h volume is ${turnover.toFixed(2)}x pooled liquidity, a normal, healthy turnover ratio for an actively traded token.`;
  }

  return signal({
    id: ID,
    label: LABEL,
    category: CATEGORY,
    metric: METRIC,
    maxPoints: MAX_POINTS,
    severity,
    observedValue: `${usd(volume)} in 24h (${turnover.toFixed(2)}x liquidity)`,
    explanation: subset.poolsMeasured < subset.poolsCorroborated
      ? `${explanation} Measured on ${subset.poolsMeasured} of ${subset.poolsCorroborated} corroborated pools holding ${pct(subset.liquidityShare, 1)} of their reserves; pools whose providers disagree on volume are excluded from both volume and liquidity.`
      : explanation,
    evidence: [
      { label: "24h volume", value: usd(volume) },
      { label: "Liquidity of the same pools", value: usd(liquidity) },
      { label: "Turnover ratio", value: `${turnover.toFixed(3)}x` },
      ...coverageEvidence(subset),
    ],
  });
}

/**
 * Balance between buys and sells over 24h. A heavily one-sided market can
 * indicate a coordinated exit in progress.
 */
export function tradeImbalanceRule({ marketData }: AnalysisInput): RiskSignal {
  const ID = "trade-imbalance";
  const LABEL = "Buy / Sell Balance";
  const METRIC = "Share of 24h trades that were sells";
  const MAX_POINTS = 6;
  const MIN_TRADES = 50;

  const activity = validationOf(marketData).activity, subset = validationOf(marketData).activitySubset;
  if (!marketData.available || activity.status !== "validated" || subset === null) {
    return unavailable({
      id: ID,
      label: LABEL,
      category: CATEGORY,
      metric: METRIC,
      maxPoints: MAX_POINTS,
      reason: marketData.available
        ? `Independently validated buy/sell activity was unavailable. ${activity.reason}.`
        : NO_MARKET_DATA(marketData.error),
    });
  }

  // Counts come only from pools whose buys AND sells both validated.
  const { buys, sells } = subset;
  const total = buys + sells;

  // Below a handful of trades the ratio is noise, not signal.
  if (total < MIN_TRADES) {
    return unavailable({
      id: ID,
      label: LABEL,
      category: CATEGORY,
      metric: METRIC,
      maxPoints: MAX_POINTS,
      reason: `Only ${total} trades were recorded in the last 24 hours, too few for the buy/sell ratio to be statistically meaningful (at least ${MIN_TRADES} are required).`,
      evidence: [
        { label: "24h buys", value: String(buys) },
        { label: "24h sells", value: String(sells) },
      ],
    });
  }

  const sellShare = sells / total;
  const severity: Severity =
    sellShare > 0.85 ? "high" : sellShare > 0.75 ? "medium" : sellShare > 0.65 ? "low" : "none";

  return signal({
    id: ID,
    label: LABEL,
    category: CATEGORY,
    metric: METRIC,
    maxPoints: MAX_POINTS,
    severity,
    observedValue: `${pct(sellShare, 1)} sells (${buys} buys / ${sells} sells)`,
    explanation:
      severity === "none"
        ? `Buys and sells are reasonably balanced over the last 24 hours (${pct(sellShare, 1)} of trades were sells), which is what an ordinary two-sided market looks like.`
        : `${pct(sellShare, 1)} of the last 24 hours' trades were sells. A market this one-sided can indicate holders exiting in concert, though it can also simply follow a period of price appreciation.`,
    evidence: [
      { label: "24h buys", value: String(buys) },
      { label: "24h sells", value: String(sells) },
      { label: "Sell share", value: pct(sellShare, 1) },
      ...coverageEvidence(subset),
    ],
  });
}

const VOLATILITY_BANDS: readonly Band[] = [
  [15, "none"],
  [35, "low"],
  [60, "medium"],
  [85, "high"],
  [Infinity, "critical"],
];

/** Absolute 24h price movement, as a proxy for near-term instability. */
export function priceVolatilityRule({ marketData }: AnalysisInput): RiskSignal {
  const ID = "price-volatility";
  const LABEL = "24h Price Movement";
  const METRIC = "Absolute price change over 24 hours";
  const MAX_POINTS = 6;

  const change = priceChange24h(marketData);

  if (change === null) {
    return unavailable({
      id: ID,
      label: LABEL,
      category: CATEGORY,
      metric: METRIC,
      maxPoints: MAX_POINTS,
      reason: marketData.available
        ? validationOf(marketData).change24h.reason
        : NO_MARKET_DATA(marketData.error),
    });
  }

  const magnitude = Math.abs(change);
  const severity = classify(magnitude, VOLATILITY_BANDS);
  const direction = change >= 0 ? "up" : "down";

  return signal({
    id: ID,
    label: LABEL,
    category: CATEGORY,
    metric: METRIC,
    maxPoints: MAX_POINTS,
    severity,
    observedValue: `${change >= 0 ? "+" : ""}${change.toFixed(2)}% in 24h`,
    explanation:
      severity === "none"
        ? `The price moved ${direction} ${magnitude.toFixed(2)}% over the last 24 hours, within a normal range.`
        : `The price moved ${direction} ${magnitude.toFixed(2)}% over the last 24 hours. Swings of this size mean the position's value can change dramatically within hours, in either direction. Note that a large upward move is scored the same as a downward one: both indicate instability, not a prediction of what comes next.`,
    evidence: [
      { label: "24h change", value: `${change.toFixed(2)}%` },
      { label: "Measurement", value: validationOf(marketData).change24hSubset ? "Depth-weighted same-pool return corroborated across providers" : "Independent provider 24h return agreement" },
      ...(validationOf(marketData).change24hSubset ? coverageEvidence(validationOf(marketData).change24hSubset!) : []),
    ],
  });
}
