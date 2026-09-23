import type {
  Evidence,
  LiquiditySafety,
  LiquiditySafetyPool,
} from "../risk-engine/types";

/**
 * Liquidity-lock aggregation: many pools, one defensible answer.
 *
 * This module is deliberately pure. Everything it needs has already been read
 * from chain by `lpCustody`; what happens here is the part that is easy to get
 * wrong and therefore worth testing directly — weighting pools by depth,
 * keeping burned liquidity *inside* the locked figure rather than beside it,
 * and refusing to state a number when too little of the market was measurable.
 *
 * Three rules govern every figure below.
 *
 * **Burned is a subset of locked, never an addend.** A pool whose LP sits
 * entirely at an incinerator is 100% locked *of which* 100% burned. Adding the
 * two would report 200%, which is the specific arithmetic error this module
 * exists to prevent.
 *
 * **Shares are of measured liquidity, not of all liquidity.** Reporting "80%
 * locked" while silently ignoring two thirds of the market that could not be
 * read would be worse than saying nothing. The measured share is carried as
 * `coverage` and stated wherever the percentages are.
 *
 * **Nothing measured means nothing claimed.** Unmeasurable liquidity is never
 * counted as unlocked — an absent measurement and a withdrawable pool are
 * opposite findings and must never render as the same number.
 */

/** Coverage at or above this is a complete enough picture to call verified. */
const HIGH_COVERAGE = 0.9;
/** Below this, the measured pools are a minority of the market. */
const MEDIUM_COVERAGE = 0.5;

/** A share of a pool's LP supply, 0-1, or null when it was not measured. */
type Fraction = number | null;

/**
 * Liquidity-weighted mean of one custody fraction across pools.
 *
 * A single unmeasured input collapses the whole figure to null rather than
 * being treated as zero: a pool whose custody could not be read is not a pool
 * with no locked liquidity.
 */
function weighted(
  pools: LiquiditySafetyPool[],
  weight: number,
  pick: (pool: LiquiditySafetyPool) => Fraction,
): number | null {
  if (weight <= 0) return null;
  let sum = 0;
  for (const pool of pools) {
    const fraction = pick(pool);
    if (fraction === null) return null;
    sum += pool.liquidityUsd * fraction;
  }
  return clamp(sum / weight);
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Combine per-pool custody into the token-wide result.
 *
 * `totalLiquidityUsd` is the figure the rest of the report already shows — the
 * consensus total across every accepted market — so coverage is expressed
 * against the same denominator the reader sees above rather than a private one
 * computed here.
 */
export function aggregateLiquiditySafety(
  pools: LiquiditySafetyPool[],
  totalLiquidityUsd: number | null,
): LiquiditySafety {
  const notes: string[] = [];

  const measured = pools.filter((pool) => pool.unmeasuredReason === null);
  const unmeasured = pools.filter((pool) => pool.unmeasuredReason !== null);

  const measuredLiquidityUsd = measured.reduce(
    (sum, pool) => sum + pool.liquidityUsd,
    0,
  );
  const coverage =
    totalLiquidityUsd !== null && totalLiquidityUsd > 0
      ? clamp(measuredLiquidityUsd / totalLiquidityUsd)
      : null;

  if (unmeasured.length > 0) {
    const unmeasuredUsd = unmeasured.reduce((sum, p) => sum + p.liquidityUsd, 0);
    notes.push(
      `${unmeasured.length} pool${unmeasured.length === 1 ? "" : "s"} holding ${formatUsd(
        unmeasuredUsd,
      )} could not be measured: ${summariseReasons(unmeasured)}.`,
    );
  }

  // Nothing tradable at all is a different answer from nothing measurable.
  if (totalLiquidityUsd !== null && totalLiquidityUsd <= 0) {
    return empty("no-liquidity", totalLiquidityUsd, notes, pools);
  }

  /*
   * Weighting needs depth to weight by. Measured pools that are all empty
   * carry no information about where the market's liquidity actually sits, so
   * the result is withheld rather than averaged over zeroes.
   */
  if (measured.length === 0 || measuredLiquidityUsd <= 0) {
    return empty("unmeasured", totalLiquidityUsd, notes, pools);
  }

  const burnedPercent = weighted(measured, measuredLiquidityUsd, (p) => p.burnedFraction);
  const frozenPercent = weighted(measured, measuredLiquidityUsd, (p) => p.frozenFraction);
  const lockCustodyPercent = weighted(
    measured,
    measuredLiquidityUsd,
    (p) => p.lockCustodyFraction,
  );
  const unlockedPercent = weighted(
    measured,
    measuredLiquidityUsd,
    (p) => p.withdrawableFraction,
  );
  const unattributedPercent = weighted(
    measured,
    measuredLiquidityUsd,
    (p) => p.unattributedFraction,
  );

  /*
   * Locked is what provably cannot be withdrawn: LP held where it can never be
   * redeemed, plus LP in frozen token accounts. Burned is the part of that
   * which is permanent, and is reported *inside* this figure, never beside it.
   *
   * Lock-program custody is deliberately excluded. The project already makes
   * this distinction for token holdings: custody by a lock or vesting program
   * is disclosed, but its release schedule cannot be read generically, so
   * calling it locked would claim a guarantee that was never verified.
   */
  const lockedPercent =
    burnedPercent === null || frozenPercent === null
      ? null
      : clamp(burnedPercent + frozenPercent);

  const confidence =
    coverage === null
      ? "low"
      : coverage >= HIGH_COVERAGE
        ? "high"
        : coverage >= MEDIUM_COVERAGE
          ? "medium"
          : "low";

  const status: LiquiditySafety["status"] =
    coverage !== null && coverage >= HIGH_COVERAGE ? "measured" : "partial";

  /*
   * An expiry is stated only where the lock is permanent by construction:
   * burned LP can never be redeemed, so there is nothing to expire. A frozen
   * account can be thawed by the freeze authority, and a timed lock lives
   * inside a program whose schedule this product does not decode — so both
   * leave the expiry unstated rather than carrying a guessed date.
   */
  const lockExpiry =
    lockedPercent !== null && lockedPercent > 0 && frozenPercent === 0
      ? "permanent"
      : null;

  const lockProvider = collectProviders(measured);

  if (unattributedPercent !== null && unattributedPercent > 0.01) {
    notes.push(
      `${pct(
        unattributedPercent,
      )} of measured LP supply sits outside the 20 largest LP accounts and could not be attributed. It is reported separately rather than assumed withdrawable.`,
    );
  }

  return {
    status,
    confidence,
    totalLiquidityUsd,
    measuredLiquidityUsd,
    coverage,
    lockedPercent,
    burnedPercent,
    lockCustodyPercent,
    unlockedPercent,
    unattributedPercent,
    lockExpiry,
    lockProvider,
    sources: ["Solana RPC — LP mint supply and holder custody, read on chain"],
    pools,
    evidence: buildEvidence(measured, measuredLiquidityUsd, coverage),
    notes,
  };
}

/**
 * The mechanisms actually observed holding LP, for attribution.
 *
 * Only burn destinations and lock programs are named: a farm or an ordinary
 * wallet is not a lock provider, and listing one here would imply a guarantee
 * that does not exist.
 */
function collectProviders(pools: LiquiditySafetyPool[]): string | null {
  const providers = [
    ...new Set(
      pools.flatMap((pool) =>
        pool.holders
          .filter(
            (holder) => holder.custody === "lock-program" || holder.custody === "burned",
          )
          .map((holder) => holder.label)
          .filter((label): label is string => Boolean(label)),
      ),
    ),
  ];
  return providers.length > 0 ? providers.join(", ") : null;
}

function empty(
  status: LiquiditySafety["status"],
  totalLiquidityUsd: number | null,
  notes: string[],
  pools: LiquiditySafetyPool[],
): LiquiditySafety {
  return {
    status,
    confidence: "none",
    totalLiquidityUsd,
    measuredLiquidityUsd: 0,
    coverage: totalLiquidityUsd !== null && totalLiquidityUsd > 0 ? 0 : null,
    lockedPercent: null,
    burnedPercent: null,
    lockCustodyPercent: null,
    unlockedPercent: null,
    unattributedPercent: null,
    lockExpiry: null,
    lockProvider: null,
    sources: [],
    pools,
    evidence: [],
    notes,
  };
}

function buildEvidence(
  measured: LiquiditySafetyPool[],
  measuredLiquidityUsd: number,
  coverage: number | null,
): Evidence[] {
  const evidence: Evidence[] = [
    { label: "Pools measured", value: String(measured.length) },
    { label: "Liquidity measured", value: formatUsd(measuredLiquidityUsd) },
    ...(coverage !== null
      ? [{ label: "Share of total liquidity measured", value: pct(coverage) }]
      : []),
  ];

  // Deepest first: these are the pools that actually move the weighted result.
  for (const pool of [...measured].sort((a, b) => b.liquidityUsd - a.liquidityUsd)) {
    evidence.push({
      label: `${pool.dexId} · ${formatUsd(pool.liquidityUsd)}`,
      value: describePool(pool),
      ...(pool.lpMint ? { href: `https://solscan.io/token/${pool.lpMint}` } : {}),
    });
  }

  return evidence;
}

function describePool(pool: LiquiditySafetyPool): string {
  const parts: string[] = [];
  if (pool.burnedFraction) parts.push(`${pct(pool.burnedFraction)} burned`);
  if (pool.frozenFraction) parts.push(`${pct(pool.frozenFraction)} frozen`);
  if (pool.lockCustodyFraction)
    parts.push(`${pct(pool.lockCustodyFraction)} in lock custody`);
  if (pool.withdrawableFraction)
    parts.push(`${pct(pool.withdrawableFraction)} withdrawable`);
  if (pool.unattributedFraction)
    parts.push(`${pct(pool.unattributedFraction)} unattributed`);
  return parts.length > 0 ? parts.join(", ") : "no LP supply outstanding";
}

function summariseReasons(pools: LiquiditySafetyPool[]): string {
  const counts = new Map<string, number>();
  for (const pool of pools) {
    const reason = pool.unmeasuredReason ?? "unknown";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${count}× ${reason}`)
    .join("; ");
}

function pct(fraction: number): string {
  if (fraction > 0 && fraction < 0.0001) return "<0.01%";
  return `${(fraction * 100).toFixed(2)}%`;
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}
