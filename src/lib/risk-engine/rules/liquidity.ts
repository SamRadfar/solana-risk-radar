import type { AnalysisInput } from "../input";
import type { Evidence, RiskSignal, Severity } from "../types";
import {
  classifyDescending,
  pct,
  plural,
  signal,
  unavailable,
  usd,
  type Band,
} from "../helpers";
import {
  marketValuation,
  pairsByLiquidity,
  totalLiquidity,
} from "../../market/access";

/** How each valuation basis is named and explained in evidence. */
const VALUATION_BASIS = {
  "circulating-market-cap": { noun: "market cap", long: "market capitalisation", evidence: "Circulating market cap: validated price × provider-corroborated circulating supply" },
  "on-chain-supply-valuation": { noun: "on-chain supply valuation", long: "on-chain supply valuation", evidence: "On-chain supply valuation: Validated price × current on-chain minted supply (not verified circulating market cap)" },
} as const;

const CATEGORY = "Liquidity" as const;

const NO_MARKET_DATA = (error: string | undefined) =>
  `Independent market measurement is unavailable. ${error ?? ""}`.trim();

/** Bands are descending: a larger value is safer. */
const DEPTH_BANDS: readonly Band[] = [
  [1_000_000, "none"],
  [250_000, "low"],
  [50_000, "medium"],
  [10_000, "high"],
  [-Infinity, "critical"],
];

/**
 * Calibrated against real mainnet tokens rather than round numbers. Observed
 * liquidity-to-market-cap on established assets sits far lower than intuition
 * suggests — around 5% for a token whose market is mostly on-DEX, and well
 * under 1% for large assets whose supply mostly sits in wallets, treasuries
 * and centralised exchanges.
 */
const RATIO_BANDS: readonly Band[] = [
  [0.05, "none"],
  [0.02, "low"],
  [0.005, "medium"],
  [0.001, "high"],
  [-Infinity, "critical"],
];

/**
 * Ceilings that apply when absolute depth is already ample.
 *
 * The question this rule exists to answer is "could holders actually exit?".
 * For a mega-cap token the ratio is structurally tiny — most supply was never
 * in a pool to begin with — and reading that as danger is simply wrong: USDC
 * measures 0.06% while carrying tens of millions of dollars of depth, which
 * absorbs any realistic exit. So once absolute liquidity is deep enough for
 * the ratio to stop mattering, the severity it can assign is capped.
 */
const DEPTH_CEILINGS: readonly [minLiquidityUsd: number, ceiling: Severity][] = [
  [5_000_000, "low"],
  [1_000_000, "medium"],
];

const SEVERITY_ORDER: Severity[] = ["none", "low", "medium", "high", "critical"];

function capSeverity(severity: Severity, liquidityUsd: number): Severity {
  for (const [threshold, ceiling] of DEPTH_CEILINGS) {
    if (liquidityUsd >= threshold) {
      return SEVERITY_ORDER.indexOf(severity) > SEVERITY_ORDER.indexOf(ceiling)
        ? ceiling
        : severity;
    }
  }
  return severity;
}

/**
 * Total tradable depth across every indexed pool. Thin liquidity means large
 * trades move the price sharply and a position may be impossible to exit at a
 * fair price, regardless of the quoted price.
 */
export function liquidityDepthRule({ marketData }: AnalysisInput): RiskSignal {
  const ID = "liquidity-depth";
  const LABEL = "Liquidity Depth";
  const METRIC = "Total USD liquidity across corroborated pools";
  const MAX_POINTS = 16;

  if (!marketData.available || totalLiquidity(marketData) === null) {
    return unavailable({
      id: ID,
      label: LABEL,
      category: CATEGORY,
      metric: METRIC,
      maxPoints: MAX_POINTS,
      reason: NO_MARKET_DATA(marketData.error),
    });
  }

  const liquidity = totalLiquidity(marketData)!;
  const severity = classifyDescending(liquidity, DEPTH_BANDS);
  const pools = pairsByLiquidity(marketData);

  const evidence: Evidence[] = [
    { label: "Total liquidity", value: usd(liquidity) },
    { label: "Pools", value: String(pools.length) },
    ...pools.slice(0, 5).map((pool) => ({
      label: `${pool.dexId}${pool.quoteSymbol ? ` · ${pool.quoteSymbol} pair` : ""}`,
      value: usd(pool.liquidityUsd),
      ...(pool.url ? { href: pool.url } : {}),
    })),
  ];

  return signal({
    id: ID,
    label: LABEL,
    category: CATEGORY,
    metric: METRIC,
    maxPoints: MAX_POINTS,
    severity,
    observedValue: `${usd(liquidity)} across ${plural(pools.length, "pool")}`,
    explanation:
      severity === "none"
        ? `Total liquidity across independently corroborated pools is ${usd(liquidity)}, deep enough to absorb ordinary trade sizes without severe price impact.`
        : `Total liquidity across independently corroborated pools is only ${usd(liquidity)}. Trades of any meaningful size will move the price significantly, and exiting a large position may not be possible at the quoted price.`,
    evidence,
  });
}

/**
 * Liquidity measured against market capitalisation.
 *
 * Absolute depth alone is misleading: $200k of liquidity is healthy for a $1M
 * token and dangerously thin for a $500M one. This ratio is what determines
 * whether the market could actually absorb holders trying to exit.
 */
export function liquidityRatioRule({ marketData, mintInfo }: AnalysisInput): RiskSignal {
  const ID = "liquidity-ratio";
  const LABEL = "Liquidity vs Market Cap";
  const METRIC = "Liquidity as a share of market capitalisation";
  const MAX_POINTS = 10;

  // Validated circulating market cap first; otherwise a transparently labelled
  // on-chain supply valuation (validated price × meaningful minted supply).
  const valuation = marketData.available
    ? marketValuation(marketData, mintInfo.supplyIsMeaningful ? mintInfo.supplyUi : undefined)
    : null;
  const cap = valuation?.value ?? null;
  const liquidity = marketData.available ? totalLiquidity(marketData) : 0;

  if (!marketData.available || valuation === null || cap === null || cap <= 0 || liquidity === null) {
    return unavailable({
      id: ID,
      label: LABEL,
      category: CATEGORY,
      metric: METRIC,
      maxPoints: MAX_POINTS,
      reason: marketData.available
        ? totalLiquidity(marketData) === null
          ? "Independently corroborated reserves are required to measure this ratio."
          : "A validated price with either corroborated circulating supply or meaningful on-chain supply is required to measure this ratio."
        : NO_MARKET_DATA(marketData.error),
    });
  }

  const basis = VALUATION_BASIS[valuation.basis];
  const ratio = liquidity / cap;
  const rawSeverity = classifyDescending(ratio, RATIO_BANDS);
  const severity = capSeverity(rawSeverity, liquidity);
  const wasCapped = severity !== rawSeverity;

  return signal({
    id: ID,
    label: LABEL,
    category: CATEGORY,
    metric: METRIC,
    maxPoints: MAX_POINTS,
    severity,
    observedValue: `${pct(ratio)} of ${basis.noun}`,
    explanation: (wasCapped
      ? `Pooled liquidity is ${pct(ratio)} of this token's ${usd(cap)} ${basis.long}. That ratio is low, but ${usd(liquidity)} of absolute depth is more than enough to absorb any realistic exit, so this is scored as a minor signal rather than a serious one. A small ratio is normal for large tokens, whose supply mostly sits in wallets and exchanges rather than in pools.`
      : severity === "none"
        ? `Pooled liquidity equals ${pct(ratio)} of this token's ${usd(cap)} ${basis.long} — a healthy ratio, meaning the valuation is backed by a market deep enough to trade against.`
        : `Pooled liquidity is only ${pct(ratio)} of this token's ${usd(cap)} ${basis.long}. The valuation rests on comparatively little real depth, so holders attempting to exit together would find far less to sell into than the valuation implies.`) +
      (valuation.basis === "on-chain-supply-valuation"
        ? " Circulating supply could not be corroborated, so the valuation uses the full current on-chain minted supply; locked or unissued supply is not excluded, which can make this ratio look lower than a circulating-supply ratio would."
        : ""),
    evidence: [
      { label: "Total liquidity", value: usd(liquidity) },
      { label: valuation.basis === "circulating-market-cap" ? "Market cap" : "On-chain supply valuation", value: usd(cap) },
      { label: "Valuation basis", value: basis.evidence },
      { label: "Ratio", value: pct(ratio) },
      ...(wasCapped
        ? [{ label: "Severity capped", value: `${rawSeverity} → ${severity} (ample absolute depth)` }]
        : []),
    ],
  });
}

/**
 * How many independent pools hold meaningful liquidity. A token whose entire
 * market is one pool has a single point of failure: if that pool is drained or
 * its LP tokens are pulled, trading stops outright.
 */
export function poolDiversityRule({ marketData }: AnalysisInput): RiskSignal {
  const ID = "pool-diversity";
  const LABEL = "Pool Diversity";
  const METRIC = "Number of pools holding meaningful liquidity";
  const MAX_POINTS = 6;
  const MEANINGFUL_USD = 1_000;

  if (!marketData.available || totalLiquidity(marketData) === null) {
    return unavailable({
      id: ID,
      label: LABEL,
      category: CATEGORY,
      metric: METRIC,
      maxPoints: MAX_POINTS,
      reason: NO_MARKET_DATA(marketData.error),
    });
  }

  const meaningful = pairsByLiquidity(marketData).filter(
    (pair) => pair.liquidityUsd >= MEANINGFUL_USD,
  );
  const total = totalLiquidity(marketData)!;
  const topShare = total > 0 && meaningful.length > 0 ? meaningful[0].liquidityUsd / total : 1;

  const severity =
    meaningful.length === 0
      ? "high"
      : meaningful.length === 1
        ? "medium"
        : meaningful.length === 2
          ? "low"
          : "none";

  return signal({
    id: ID,
    label: LABEL,
    category: CATEGORY,
    metric: METRIC,
    maxPoints: MAX_POINTS,
    severity,
    observedValue:
      meaningful.length === 0
        ? `No pool holds more than ${usd(MEANINGFUL_USD)}`
        : `${plural(meaningful.length, "pool")}, deepest holds ${pct(topShare, 1)}`,
    explanation:
      meaningful.length === 0
        ? `No corroborated pool holds more than ${usd(MEANINGFUL_USD)} in liquidity. Other venues may exist outside this measured subset.`
        : meaningful.length === 1
          ? `The corroborated pool subset contains a single pool on ${meaningful[0].dexId}. If that pool's liquidity is withdrawn, trading stops entirely — this is the structure a liquidity rug-pull depends on.`
          : `Liquidity is spread across ${plural(meaningful.length, "pool")}, with the deepest holding ${pct(topShare, 1)} of the total. Multiple independent venues mean trading does not depend on any single pool remaining funded.`,
    evidence: [
      { label: `Pools above ${usd(MEANINGFUL_USD)}`, value: String(meaningful.length) },
      { label: "Pools indexed in total", value: String(marketData.pairs.length) },
      { label: "Deepest pool's share", value: pct(topShare, 1) },
    ],
  });
}
