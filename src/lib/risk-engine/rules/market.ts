import type { AnalysisInput } from "../input";
import type { RiskSignal, Severity } from "../types";
import { classify, pct, signal, unavailable, usd, type Band } from "../helpers";
import {
  pairsByLiquidity,
  validationOf,
  priceChange24h,
  totalLiquidity,
  totalVolume24h,
} from "../../market/access";

const CATEGORY = "Market Activity" as const;

const NO_MARKET_DATA = (error: string | undefined) =>
  `Independently validated market data is unavailable. ${error ?? ""}`.trim();

const NO_POOLS =
  "No liquidity pool was found for this token, so there is no trading activity to assess.";

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

  if (!marketData.available || totalLiquidity(marketData) === null || totalVolume24h(marketData) === null) {
    return unavailable({
      id: ID,
      label: LABEL,
      category: CATEGORY,
      metric: METRIC,
      maxPoints: MAX_POINTS,
      reason: NO_MARKET_DATA(marketData.error),
    });
  }
  if (marketData.pairs.length === 0) {
    return unavailable({
      id: ID,
      label: LABEL,
      category: CATEGORY,
      metric: METRIC,
      maxPoints: MAX_POINTS,
      reason: NO_POOLS,
    });
  }

  const liquidity = totalLiquidity(marketData);
  const volume = totalVolume24h(marketData);

  if (liquidity === null || volume === null || liquidity <= 0) {
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
    explanation,
    evidence: [
      { label: "24h volume", value: usd(volume) },
      { label: "Total liquidity", value: usd(liquidity) },
      { label: "Turnover ratio", value: `${turnover.toFixed(3)}x` },
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

  if (!marketData.available || validationOf(marketData).activity.status !== "validated") {
    return unavailable({
      id: ID,
      label: LABEL,
      category: CATEGORY,
      metric: METRIC,
      maxPoints: MAX_POINTS,
      reason: marketData.available ? NO_POOLS : NO_MARKET_DATA(marketData.error),
    });
  }

  // Validated activity proves both counts exist for every projected pool.
  const buys = pairsByLiquidity(marketData).reduce((sum, pair) => sum + pair.buys24h!, 0);
  const sells = pairsByLiquidity(marketData).reduce((sum, pair) => sum + pair.sells24h!, 0);
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
      { label: "Measurement", value: "Independent provider 24h return agreement" },
    ],
  });
}
