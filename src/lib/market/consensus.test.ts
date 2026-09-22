import { describe, expect, it } from "vitest";

import type { MarketData, MarketPair } from "../providers/dexscreener";
import {
  fullyDilutedValuation,
  marketCap,
  marketConsensus,
  priceChange24h,
  spotPrice,
  totalLiquidity,
  totalVolume24h,
} from "../providers/dexscreener";
import { buildConsensus } from "./consensus";

/**
 * Market-data regression suite.
 *
 * These tests exist because the product once shipped a price that was wrong by
 * three orders of magnitude, and nothing caught it. They assert *behaviour* —
 * that a crowd of agreeing markets outranks one loud one — never a particular
 * dollar figure, so they keep working as real prices move.
 */

let sequence = 0;

function pool(overrides: Partial<MarketPair> = {}): MarketPair {
  sequence += 1;
  return {
    dexId: "raydium",
    pairAddress: `pool-${sequence}`,
    quoteSymbol: "SOL",
    liquidityUsd: 500_000,
    volume24hUsd: 250_000,
    priceUsd: 1,
    pairCreatedAt: Date.now() - 400 * 24 * 60 * 60 * 1000,
    fdv: null,
    marketCap: null,
    priceChange24h: 1,
    buys24h: 400,
    sells24h: 380,
    url: null,
    info: { imageUrl: null, websites: [], socials: [] },
    ...overrides,
  };
}

function market(pairs: MarketPair[]): MarketData {
  return {
    available: true,
    pairs,
    name: "Test",
    symbol: "TEST",
    imageUrl: null,
    websites: [],
    socials: [],
  };
}

/** A believable spread of honest markets around one price. */
function cluster(price: number, count: number, liquidity = 400_000): MarketPair[] {
  return Array.from({ length: count }, (_, i) =>
    pool({
      // A few tenths of a percent apart, as real venues are.
      priceUsd: price * (1 + (i - count / 2) * 0.001),
      liquidityUsd: liquidity,
      dexId: ["raydium", "orca", "meteora", "lifinity", "phoenix"][i % 5],
    }),
  );
}

describe("canonical price consensus", () => {
  it("takes the cluster the market agrees on", () => {
    const consensus = buildConsensus(market(cluster(0.3, 9)));

    expect(consensus.available).toBe(true);
    expect(consensus.acceptedCount).toBe(9);
    expect(consensus.priceUsd).toBeGreaterThan(0.29);
    expect(consensus.priceUsd).toBeLessThan(0.31);
  });

  /**
   * The BONK regression, stated as behaviour.
   *
   * A Meteora pool quoted BONK thousands of times above the market while
   * reporting the deepest liquidity of any pool. Under "deepest pool wins" it
   * became the canonical price and took market cap and 24h change with it.
   * The scenario is reconstructed here with a synthetic price, so the test
   * asserts that consensus survives the attack rather than pinning a number
   * that will be stale tomorrow.
   */
  it("does not let one anomalous deep pool override a broad market", () => {
    const real = 0.0000234;
    const pools = [
      ...cluster(real, 9, 300_000),
      pool({
        dexId: "meteora",
        priceUsd: real * 5000,
        // Deeper than every honest pool put together.
        liquidityUsd: 36_500_000,
        volume24hUsd: 5_000_000,
        priceChange24h: 495_616,
        marketCap: 1_320_000_000_000,
      }),
    ];

    const consensus = buildConsensus(market(pools));
    const anomaly = consensus.observations.find((o) => o.priceUsd === real * 5000);

    // The canonical price stays inside the honest cluster.
    expect(consensus.priceUsd).toBeGreaterThan(real * 0.95);
    expect(consensus.priceUsd).toBeLessThan(real * 1.05);

    // The anomaly is rejected, and the reason is recorded.
    expect(anomaly?.accepted).toBe(false);
    expect(anomaly?.rejection).toMatch(/consensus/i);

    // Its liquidity and volume are excluded from the totals it would inflate.
    expect(consensus.liquidityUsd).toBeLessThan(36_500_000);
    expect(consensus.acceptedCount).toBe(9);
    expect(consensus.rejectedCount).toBe(1);

    // And it cannot drag the 24h change with it.
    expect(consensus.priceChange24hPercent).toBeLessThan(100);
  });

  it("rejects an outlier priced far below the market as well as far above", () => {
    const pools = [...cluster(2, 6), pool({ priceUsd: 0.002, liquidityUsd: 9_000_000 })];
    const consensus = buildConsensus(market(pools));

    expect(consensus.priceUsd).toBeGreaterThan(1.9);
    expect(consensus.observations.find((o) => o.priceUsd === 0.002)?.rejection).toMatch(
      /below the market consensus/i,
    );
  });

  it("holds the line even when outliers outnumber the honest cluster in count", () => {
    // Four thin manipulated pools against three deep honest ones: weight, not
    // headcount, decides.
    const pools = [
      ...cluster(1, 3, 2_000_000),
      pool({ priceUsd: 50, liquidityUsd: 3_000, volume24hUsd: 100 }),
      pool({ priceUsd: 51, liquidityUsd: 3_000, volume24hUsd: 100 }),
      pool({ priceUsd: 52, liquidityUsd: 3_000, volume24hUsd: 100 }),
      pool({ priceUsd: 53, liquidityUsd: 3_000, volume24hUsd: 100 }),
    ];
    const consensus = buildConsensus(market(pools));

    expect(consensus.priceUsd).toBeGreaterThan(0.9);
    expect(consensus.priceUsd).toBeLessThan(1.1);
  });

  it("never lets a mean-style estimator be dragged by one extreme value", () => {
    const withOutlier = buildConsensus(
      market([...cluster(1, 5), pool({ priceUsd: 1_000_000, liquidityUsd: 800_000 })]),
    );
    const withoutOutlier = buildConsensus(market(cluster(1, 5)));

    expect(withOutlier.priceUsd).toBeCloseTo(withoutOutlier.priceUsd as number, 6);
  });
});

describe("pool validation", () => {
  it("ignores pairs where the analysed mint is not the base token", () => {
    const consensus = buildConsensus(
      market([...cluster(1, 3), pool({ priceUsd: null, liquidityUsd: 5_000_000 })]),
    );

    expect(consensus.acceptedCount).toBe(3);
    expect(
      consensus.observations.find((o) => o.rejection?.includes("not the base token")),
    ).toBeDefined();
  });

  it("counts a duplicated pool once", () => {
    const shared = pool({ liquidityUsd: 400_000 });
    const consensus = buildConsensus(market([shared, { ...shared }, ...cluster(1, 2)]));

    expect(consensus.acceptedCount).toBe(3);
    expect(
      consensus.observations.find((o) => o.rejection === "Duplicate of a pool already counted"),
    ).toBeDefined();
    expect(consensus.liquidityUsd).toBe(400_000 + 400_000 + 400_000);
  });

  it("discards dust pools, whose quoted price is not a market", () => {
    const consensus = buildConsensus(
      market([...cluster(1, 3), pool({ priceUsd: 99, liquidityUsd: 12 })]),
    );

    expect(consensus.acceptedCount).toBe(3);
    expect(
      consensus.observations.find((o) => o.rejection?.includes("Negligible liquidity")),
    ).toBeDefined();
  });

  it("discards prices and liquidity that are not usable numbers", () => {
    const consensus = buildConsensus(
      market([
        ...cluster(1, 3),
        pool({ priceUsd: 0 }),
        pool({ priceUsd: Number.NaN }),
        pool({ liquidityUsd: Number.NaN }),
      ]),
    );

    expect(consensus.acceptedCount).toBe(3);
    expect(consensus.rejectedCount).toBe(3);
  });

  it("records a reason for every rejection", () => {
    const consensus = buildConsensus(
      market([...cluster(1, 4), pool({ priceUsd: 500, liquidityUsd: 900_000 })]),
    );

    for (const observation of consensus.observations) {
      if (!observation.accepted) expect(observation.rejection).toBeTruthy();
    }
  });
});

describe("confidence", () => {
  it("is high when several strong markets agree closely", () => {
    const consensus = buildConsensus(
      market(cluster(1, 6).map((p) => ({ ...p, quoteSymbol: "USDC" }))),
    );
    expect(consensus.confidence).toBe("high");
  });

  it("is low when a single market is all the evidence there is", () => {
    const consensus = buildConsensus(market([pool({ quoteSymbol: "WIF" })]));
    expect(consensus.confidence).toBe("low");
    // Still produces a defensible estimate rather than refusing outright.
    expect(consensus.priceUsd).toBe(1);
  });

  it("is none, with no price, when nothing survives validation", () => {
    const consensus = buildConsensus(market([pool({ liquidityUsd: 5 })]));
    expect(consensus.confidence).toBe("none");
    expect(consensus.priceUsd).toBeNull();
    expect(consensus.available).toBe(false);
  });

  it("degrades when accepted markets disagree widely", () => {
    const spread = [
      pool({ priceUsd: 1.0 }),
      pool({ priceUsd: 1.2 }),
      pool({ priceUsd: 1.25 }),
    ];
    expect(buildConsensus(market(spread)).confidence).not.toBe("high");
  });
});

describe("aggregates follow the consensus", () => {
  const withOutlier = market([
    ...cluster(1, 4, 250_000),
    pool({ priceUsd: 900, liquidityUsd: 10_000_000, volume24hUsd: 9_000_000 }),
  ]);

  it("counts only validated liquidity and volume", () => {
    expect(totalLiquidity(withOutlier)).toBe(1_000_000);
    expect(totalVolume24h(withOutlier)).toBe(1_000_000);
  });

  it("prices from the consensus, not the deepest pool", () => {
    expect(spotPrice(withOutlier)).toBeLessThan(2);
  });

  it("takes 24h change from the consensus too", () => {
    const skewed = market([
      ...cluster(1, 4),
      pool({ priceUsd: 900, liquidityUsd: 10_000_000, priceChange24h: 400_000 }),
    ]);
    expect(priceChange24h(skewed)).toBeLessThan(100);
  });

  it("reads history from a pool inside the accepted cluster", () => {
    const consensus = marketConsensus(withOutlier);
    const chosen = consensus.canonicalPool?.pairAddress;
    const observation = consensus.observations.find((o) => o.pairAddress === chosen);

    expect(observation?.accepted).toBe(true);
    expect(observation?.priceUsd).toBeLessThan(2);
  });
});

describe("market cap and fully diluted valuation stay distinct", () => {
  const supplyUi = 1_000_000;
  const half = market(
    cluster(2, 4).map((p) => ({ ...p, marketCap: 2 * (supplyUi / 2), priceUsd: 2 })),
  );

  it("builds market cap from the canonical price and implied circulating supply", () => {
    const cap = marketCap(half, supplyUi);
    // Half the supply circulating at $2 is a $1M cap, not the $2M fully diluted.
    expect(cap).toBeCloseTo(1_000_000, 0);
  });

  it("builds fully diluted value from the same price and the on-chain total", () => {
    expect(fullyDilutedValuation(half, supplyUi)).toBeCloseTo(2_000_000, 0);
  });

  it("never substitutes one for the other", () => {
    expect(marketCap(half, supplyUi)).not.toBe(fullyDilutedValuation(half, supplyUi));
  });

  it("withholds a market cap implying more circulating supply than exists", () => {
    const impossible = market(
      cluster(1, 4).map((p) => ({ ...p, priceUsd: 1, marketCap: 50_000_000 })),
    );
    // 50M circulating claimed against a 1M supply: the claim is about some
    // other token, so no figure is published.
    expect(marketCap(impossible, supplyUi)).toBeNull();
    // The fully diluted value is still computable, because it uses our supply.
    expect(fullyDilutedValuation(impossible, supplyUi)).toBeCloseTo(1_000_000, 0);
  });

  it("withholds both when no market could be trusted", () => {
    const dust = market([pool({ liquidityUsd: 5 })]);
    expect(marketCap(dust, supplyUi)).toBeNull();
    expect(fullyDilutedValuation(dust, supplyUi)).toBeNull();
  });
});

describe("empty and degenerate markets", () => {
  it("reports nothing when the provider failed", () => {
    const consensus = buildConsensus({
      available: false,
      pairs: [],
      name: null,
      symbol: null,
      imageUrl: null,
      websites: [],
      socials: [],
      error: "down",
    });
    expect(consensus.priceUsd).toBeNull();
    expect(consensus.confidence).toBe("none");
  });

  it("reports nothing when the token has no pools at all", () => {
    expect(buildConsensus(market([])).priceUsd).toBeNull();
  });
});
