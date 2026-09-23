import { describe, expect, it } from "vitest";

import type { LiquiditySafetyPool, LpHolding } from "../risk-engine/types";
import { classifyLpHolder } from "../solana/lpControl";
import { aggregateLiquiditySafety } from "./liquiditySafety";

/**
 * Liquidity-lock regression suite.
 *
 * These tests assert the three properties the feature is only trustworthy
 * because of: burned liquidity is reported *inside* the locked figure rather
 * than added to it, unmeasurable liquidity never becomes "unlocked", and a
 * multi-pool token is weighted by depth rather than averaged.
 *
 * They assert behaviour and relationships, never a particular percentage from
 * a particular mainnet token, so they keep working as real markets move.
 */

let sequence = 0;

/** A measured pool. Fractions default to fully withdrawable. */
function pool(overrides: Partial<LiquiditySafetyPool> = {}): LiquiditySafetyPool {
  sequence += 1;
  return {
    pairAddress: `pool-${sequence}`,
    dexId: "raydium",
    liquidityUsd: 100_000,
    lpMint: `lp-mint-${sequence}`,
    unmeasuredReason: null,
    lpSupplyRaw: "1000000",
    lpDecimals: 9,
    burnedFraction: 0,
    frozenFraction: 0,
    lockCustodyFraction: 0,
    withdrawableFraction: 1,
    unattributedFraction: 0,
    holders: [],
    ...overrides,
  };
}

/** A pool that could not be read at all. */
function unmeasured(overrides: Partial<LiquiditySafetyPool> = {}): LiquiditySafetyPool {
  return {
    ...pool(),
    lpMint: null,
    unmeasuredReason: "Orca Whirlpool has no LP token (positions are NFTs)",
    lpSupplyRaw: null,
    lpDecimals: null,
    burnedFraction: null,
    frozenFraction: null,
    lockCustodyFraction: null,
    withdrawableFraction: null,
    unattributedFraction: null,
    ...overrides,
  };
}

function holder(overrides: Partial<LpHolding> = {}): LpHolding {
  return {
    tokenAccount: "lp-token-account",
    owner: "owner",
    share: 1,
    custody: "burned",
    label: "Incinerator (burn)",
    ...overrides,
  };
}

describe("overlap between locked and burned", () => {
  it("reports burned inside locked rather than adding the two", () => {
    const result = aggregateLiquiditySafety(
      [pool({ burnedFraction: 0.808, withdrawableFraction: 0.192 })],
      100_000,
    );

    expect(result.burnedPercent).toBeCloseTo(0.808, 6);
    expect(result.lockedPercent).toBeCloseTo(0.808, 6);
    // The failure this guards against is 0.808 + 0.808 = 1.616.
    expect(result.lockedPercent).toBeLessThanOrEqual(1);
  });

  it("adds frozen LP to locked, keeping burned a strict subset", () => {
    const result = aggregateLiquiditySafety(
      [pool({ burnedFraction: 0.5, frozenFraction: 0.2, withdrawableFraction: 0.3 })],
      100_000,
    );

    expect(result.burnedPercent).toBeCloseTo(0.5, 6);
    expect(result.lockedPercent).toBeCloseTo(0.7, 6);
    expect(result.burnedPercent as number).toBeLessThan(result.lockedPercent as number);
  });

  it("never lets the reported shares exceed the whole", () => {
    const result = aggregateLiquiditySafety(
      [
        pool({
          burnedFraction: 0.4,
          frozenFraction: 0.1,
          lockCustodyFraction: 0.2,
          withdrawableFraction: 0.25,
          unattributedFraction: 0.05,
        }),
      ],
      100_000,
    );

    const total =
      (result.lockedPercent ?? 0) +
      (result.lockCustodyPercent ?? 0) +
      (result.unlockedPercent ?? 0) +
      (result.unattributedPercent ?? 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("excludes lock-program custody from locked, and discloses it separately", () => {
    const result = aggregateLiquiditySafety(
      [pool({ lockCustodyFraction: 0.9, withdrawableFraction: 0.1 })],
      100_000,
    );

    // Custody is not a verified lock: the release schedule was never read.
    expect(result.lockedPercent).toBe(0);
    expect(result.lockCustodyPercent).toBeCloseTo(0.9, 6);
  });
});

describe("unavailable data", () => {
  it("reports nothing rather than zero when no pool could be measured", () => {
    const result = aggregateLiquiditySafety([unmeasured(), unmeasured()], 250_000);

    expect(result.status).toBe("unmeasured");
    expect(result.lockedPercent).toBeNull();
    expect(result.burnedPercent).toBeNull();
    // The critical assertion: missing data must never read as "unlocked".
    expect(result.unlockedPercent).toBeNull();
    expect(result.confidence).toBe("none");
  });

  it("distinguishes a token with no market from one that could not be read", () => {
    expect(aggregateLiquiditySafety([], 0).status).toBe("no-liquidity");
    expect(aggregateLiquiditySafety([unmeasured()], 100_000).status).toBe("unmeasured");
  });

  it("withholds the aggregate when a measured pool has an unreadable fraction", () => {
    const result = aggregateLiquiditySafety(
      [pool({ burnedFraction: 0.5 }), pool({ burnedFraction: null })],
      200_000,
    );

    expect(result.burnedPercent).toBeNull();
    expect(result.lockedPercent).toBeNull();
  });

  it("withholds a result when measured pools carry no liquidity to weight by", () => {
    const result = aggregateLiquiditySafety([pool({ liquidityUsd: 0 })], 100_000);

    expect(result.status).toBe("unmeasured");
    expect(result.lockedPercent).toBeNull();
  });

  it("survives a malformed provider response without throwing", () => {
    expect(() => aggregateLiquiditySafety([], null)).not.toThrow();
    expect(() =>
      aggregateLiquiditySafety([pool({ liquidityUsd: Number.NaN })], null),
    ).not.toThrow();
  });
});

describe("multi-pool weighting", () => {
  it("weights each pool by its depth, not by pool count", () => {
    const result = aggregateLiquiditySafety(
      [
        // Deep and fully burned.
        pool({ liquidityUsd: 900_000, burnedFraction: 1, withdrawableFraction: 0 }),
        // Shallow and fully withdrawable.
        pool({ liquidityUsd: 100_000, burnedFraction: 0, withdrawableFraction: 1 }),
      ],
      1_000_000,
    );

    // Depth-weighted: 0.9. A pool-count average would give 0.5.
    expect(result.lockedPercent).toBeCloseTo(0.9, 6);
    expect(result.unlockedPercent).toBeCloseTo(0.1, 6);
  });

  it("never reports one pool's lock state as the whole token's", () => {
    const result = aggregateLiquiditySafety(
      [
        pool({ liquidityUsd: 50_000, burnedFraction: 1, withdrawableFraction: 0 }),
        pool({ liquidityUsd: 50_000, burnedFraction: 0, withdrawableFraction: 1 }),
      ],
      100_000,
    );

    expect(result.lockedPercent).toBeCloseTo(0.5, 6);
  });

  it("measures shares against measured liquidity and reports the coverage", () => {
    const result = aggregateLiquiditySafety(
      [
        pool({ liquidityUsd: 100_000, burnedFraction: 1, withdrawableFraction: 0 }),
        unmeasured({ liquidityUsd: 300_000 }),
      ],
      400_000,
    );

    // 100% of what was measured, which was a quarter of the market.
    expect(result.lockedPercent).toBeCloseTo(1, 6);
    expect(result.coverage).toBeCloseTo(0.25, 6);
    expect(result.status).toBe("partial");
    expect(result.confidence).toBe("low");
    expect(result.notes.join(" ")).toMatch(/could not be measured/i);
  });

  it("calls coverage verified only when nearly all liquidity was read", () => {
    const full = aggregateLiquiditySafety(
      [pool({ liquidityUsd: 100_000, burnedFraction: 1, withdrawableFraction: 0 })],
      100_000,
    );
    expect(full.status).toBe("measured");
    expect(full.confidence).toBe("high");

    const half = aggregateLiquiditySafety(
      [pool({ liquidityUsd: 60_000 }), unmeasured({ liquidityUsd: 40_000 })],
      100_000,
    );
    expect(half.confidence).toBe("medium");
  });
});

describe("lock expiry and provider", () => {
  it("states a permanent expiry only for a burn, never for a freeze", () => {
    const burned = aggregateLiquiditySafety(
      [pool({ burnedFraction: 1, withdrawableFraction: 0 })],
      100_000,
    );
    expect(burned.lockExpiry).toBe("permanent");

    // A freeze authority can thaw the account, so nothing is claimed.
    const frozen = aggregateLiquiditySafety(
      [pool({ frozenFraction: 1, withdrawableFraction: 0 })],
      100_000,
    );
    expect(frozen.lockExpiry).toBeNull();
  });

  it("leaves the expiry unstated when nothing is locked", () => {
    const result = aggregateLiquiditySafety([pool()], 100_000);
    expect(result.lockExpiry).toBeNull();
  });

  it("names only burn destinations and lock programs as the mechanism", () => {
    const result = aggregateLiquiditySafety(
      [
        pool({
          burnedFraction: 0.6,
          withdrawableFraction: 0.4,
          holders: [
            holder({ custody: "burned", label: "Incinerator (burn)", share: 0.6 }),
            holder({ custody: "staked", label: "Meteora Farm", share: 0.4 }),
          ],
        }),
      ],
      100_000,
    );

    expect(result.lockProvider).toBe("Incinerator (burn)");
    // A farm is withdrawable and must never be presented as a lock provider.
    expect(result.lockProvider).not.toMatch(/Farm/);
  });
});

describe("LP holder classification", () => {
  const SYSTEM = "11111111111111111111111111111111";
  const INCINERATOR = "1nc1nerator11111111111111111111111111111111";
  const RAYDIUM_LOCK = "Lock1zcQFoaZmTk59sr9pB5daFE6Cs1K5eWyRLF1eju";
  const METEORA_FARM = "FarmuwXPWXvefWUeqFAa5w6rifLkq5X6E8bimYvrhCB1";

  it("treats a burn address as burned", () => {
    expect(classifyLpHolder(INCINERATOR, SYSTEM, "initialized").custody).toBe("burned");
  });

  it("treats a known lock program as custody, not as locked", () => {
    const result = classifyLpHolder("owner", RAYDIUM_LOCK, "initialized");
    expect(result.custody).toBe("lock-program");
    expect(result.label).toBe("Raydium LP lock");
  });

  it("treats a farm as withdrawable rather than locked", () => {
    expect(classifyLpHolder("owner", METEORA_FARM, "initialized").custody).toBe("staked");
  });

  it("treats a frozen LP account as locked", () => {
    expect(classifyLpHolder("owner", SYSTEM, "frozen").custody).toBe("frozen");
  });

  it("treats an ordinary wallet as withdrawable", () => {
    expect(classifyLpHolder("owner", SYSTEM, "initialized").custody).toBe("wallet");
  });

  it("does not invent a lock for an owner it could not resolve", () => {
    expect(classifyLpHolder(null, null, null).custody).toBe("unknown");
  });
});
