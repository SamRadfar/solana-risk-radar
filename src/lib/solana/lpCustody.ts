import "server-only";

import { PublicKey } from "@solana/web3.js";

import {
  getMultipleAccountOwners,
  getMultipleAccountsBase64,
  getMultipleAccountsParsed,
  getTokenLargestAccounts,
  type TokenLargestAccount,
} from "./rpc";
import {
  LP_MINT_LAYOUTS,
  NO_LP_TOKEN_PROGRAMS,
  classifyLpHolder,
} from "./lpControl";
import type { MarketPair } from "../market/types";
import { aggregateLiquiditySafety } from "../market/liquiditySafety";
import type {
  LiquiditySafety,
  LiquiditySafetyPool,
  LpHolding,
} from "../risk-engine/types";

/**
 * Who holds a pool's LP tokens, read from chain.
 *
 * A liquidity rug-pull is the LP holder redeeming their LP for the pool's
 * reserves. So the question that actually matters is not how deep a pool is,
 * but **how much of its LP supply sits somewhere it can never be redeemed
 * from**. That is what this module measures, and it measures it the only way
 * that is defensible: by reading the LP mint's supply and the accounts holding
 * it, then classifying each account by the program that owns it.
 *
 * ## Why the LP mint, and why current supply
 *
 * LP tokens are pro-rata claims on a pool's reserves: redeeming `n` LP returns
 * `n / lpSupply` of the pool. So a holding's share of the *current* supply is
 * exactly the share of the pool it can withdraw — which makes current supply
 * the correct denominator in every case, including tokens whose LP was partly
 * destroyed. LP sent to an address nobody controls stays in the supply and can
 * never be redeemed, permanently stranding the reserves behind it; that is the
 * thing people mean by "liquidity is burned", and it is visible here.
 *
 * Raydium v4 pool accounts also carry an `lpReserve` field, and comparing it
 * to the mint's supply is a widely repeated way to infer a burn. It was tested
 * against mainnet and rejected: on a live pool it read 4.04e12 against an
 * actual LP supply of 6.24e6, which would have been published as a 99.9998%
 * burn. The field does not track the mint, so nothing here uses it.
 *
 * ## What cannot be measured, and is therefore not claimed
 *
 * Concentrated-liquidity venues — Orca Whirlpool, Raydium CLMM, Meteora DLMM,
 * Meteora DAMM v2 — have **no fungible LP token at all**. Positions are NFTs
 * with individual ranges, and there is no supply to take a share of. Bonding
 * curves likewise. Those pools are recorded with a reason and excluded, never
 * scored as unlocked. On established tokens this is most of the market, and
 * the reported coverage says so plainly rather than hiding it.
 *
 * Every layout below was validated against live mainnet pools: the pubkey at
 * the stated offset was read back and confirmed to be an initialised mint
 * account. The Raydium offsets are further corroborated by their LP mint
 * authorities resolving to Raydium's own program PDAs, and Pump.fun's by its
 * LP mint authority being the pool account itself.
 */

/**
 * How many pools to examine, deepest first.
 *
 * Each pool costs a `getTokenLargestAccounts` call, which is the method public
 * endpoints meter hardest. Five covers the overwhelming majority of any
 * token's depth; anything past it is recorded as not examined so coverage
 * stays honest rather than being quietly rounded up.
 */
const MAX_POOLS = 5;

/** Below this a pool is dust, and reading it would cost more than it tells. */
const MIN_POOL_LIQUIDITY_USD = 1_000;

/**
 * Wall-clock budget for the whole LP phase.
 *
 * This phase runs concurrently with the holder scan, which is itself the
 * slowest part of an analysis, so the budget is set to sit just inside that
 * work rather than to cut the read short: anything under it is effectively
 * free, and anything over it would start deciding how long the report takes.
 *
 * It is a backstop, not the normal path. Public endpoints meter
 * `getTokenLargestAccounts` hard and the client retries with backoff across
 * three of them, so a badly rate-limited moment could otherwise run long past
 * everything else. On expiry the pools already read are kept and the rest are
 * marked unmeasured with a stated reason — a slow endpoint costs coverage,
 * never latency and never honesty.
 */
const BUDGET_MS = 12_000;

/** Resolves to `null` if the work outlives the remaining budget. */
function withinBudget<T>(work: Promise<T>, deadline: number): Promise<T | null> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.resolve(null);
  return Promise.race([
    work,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), remaining)),
  ]);
}

/**
 * Read LP custody for a token's pools and aggregate it.
 *
 * Never throws and never rejects: every failure path degrades to a pool marked
 * unmeasured with a stated reason, because a liquidity-lock read failing must
 * reduce this section to "not measured" and must not fail the report.
 */
export async function getLiquiditySafety(
  pairs: MarketPair[],
  totalLiquidityUsd: number | null,
): Promise<LiquiditySafety> {
  const ranked = [...pairs]
    .filter((pair) => pair.pairAddress !== null)
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd);

  const candidates = ranked
    .filter((pair) => pair.liquidityUsd >= MIN_POOL_LIQUIDITY_USD)
    .slice(0, MAX_POOLS);

  if (candidates.length === 0) {
    return aggregateLiquiditySafety([], totalLiquidityUsd);
  }

  try {
    const pools = await measurePools(candidates);
    const result = aggregateLiquiditySafety(pools, totalLiquidityUsd);

    // Pools past the cap are disclosed, so coverage is never read as complete.
    const skipped = ranked.length - candidates.length;
    if (skipped > 0) {
      const skippedUsd = ranked
        .slice(candidates.length)
        .reduce((sum, pair) => sum + pair.liquidityUsd, 0);
      result.notes.push(
        `${skipped} shallower pool${skipped === 1 ? "" : "s"} holding ${formatUsd(
          skippedUsd,
        )} ${skipped === 1 ? "was" : "were"} outside the ${MAX_POOLS} deepest and not examined.`,
      );
    }

    return result;
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unknown RPC error reading LP custody.";
    return aggregateLiquiditySafety(
      candidates.map((pair) => unmeasuredPool(pair, truncateReason(reason))),
      totalLiquidityUsd,
    );
  }
}

/** Read every candidate pool, batching each round trip across all of them. */
async function measurePools(pairs: MarketPair[]): Promise<LiquiditySafetyPool[]> {
  const deadline = Date.now() + BUDGET_MS;
  const addresses = pairs.map((pair) => pair.pairAddress as string);

  // --- 1. Pool accounts -> a candidate LP mint per pool, by layout.
  const poolAccounts = await getMultipleAccountsBase64(addresses);

  const lpMintByPair = new Map<string, string>();
  const failures = new Map<string, string>();

  poolAccounts.value.forEach((account, index) => {
    const pair = addresses[index];
    if (!account) {
      failures.set(pair, "pool account could not be read");
      return;
    }

    const noLpToken = NO_LP_TOKEN_PROGRAMS[account.owner];
    if (noLpToken) {
      failures.set(pair, `${noLpToken} has no LP token (positions are NFTs)`);
      return;
    }

    const layout = LP_MINT_LAYOUTS[account.owner];
    if (!layout) {
      failures.set(pair, "unrecognised AMM program");
      return;
    }

    const data = decodeBase64(account.data?.[0]);
    if (!data || data.length < layout.offset + 32) {
      failures.set(pair, `${layout.name} pool account was shorter than its layout`);
      return;
    }

    const lpMint = encodePubkey(data.subarray(layout.offset, layout.offset + 32));
    if (!lpMint) {
      failures.set(pair, `${layout.name} LP mint could not be decoded`);
      return;
    }
    lpMintByPair.set(pair, lpMint);
  });

  // --- 2. Validate each candidate really is an initialised mint.
  //
  // This is what makes a wrong offset fail safe. If a layout were ever off,
  // the bytes read would not resolve to a mint account and the pool would be
  // reported as unmeasured rather than as a fabricated percentage.
  const candidateMints = [...new Set(lpMintByPair.values())];
  const mintInfo = new Map<string, { supply: bigint; decimals: number }>();

  if (candidateMints.length > 0) {
    const parsed = await getMultipleAccountsParsed<ParsedMintInfo>(candidateMints);
    parsed.value.forEach((account, index) => {
      const info = account?.data?.parsed;
      if (info?.type !== "mint") return;
      const supply = toBigInt(info.info?.supply);
      const decimals = Number(info.info?.decimals);
      if (supply === null || !Number.isInteger(decimals)) return;
      mintInfo.set(candidateMints[index], { supply, decimals });
    });
  }

  for (const [pair, lpMint] of lpMintByPair) {
    if (!mintInfo.has(lpMint)) {
      failures.set(pair, "decoded LP mint was not a readable mint account");
    }
  }

  const measurable = pairs.filter((pair) => {
    const lpMint = lpMintByPair.get(pair.pairAddress as string);
    return lpMint !== undefined && mintInfo.has(lpMint);
  });

  // --- 3. The largest LP holders, one call per pool.
  const largestByMint = new Map<string, TokenLargestAccount[]>();
  await Promise.all(
    [...new Set(measurable.map((p) => lpMintByPair.get(p.pairAddress as string) as string))].map(
      async (lpMint) => {
        try {
          const result = await withinBudget(getTokenLargestAccounts(lpMint), deadline);
          if (result) largestByMint.set(lpMint, result.value ?? []);
        } catch {
          // Left absent; the pools using it fall through to unmeasured below.
        }
      },
    ),
  );

  // --- 4 & 5. Resolve every LP token account to an owner, and every owner to
  // the program that owns it — both batched across all pools at once.
  const allTokenAccounts = [
    ...new Set(
      [...largestByMint.values()].flat().filter((a) => a.amount !== "0").map((a) => a.address),
    ),
  ];
  /*
   * These two reads are what make a classification possible at all. If either
   * fails, every holder would fall through to "unknown" and be counted as
   * withdrawable — publishing "100% withdrawable" on the strength of a failed
   * RPC call. So a failure here invalidates the whole measurement rather than
   * silently becoming the most alarming possible reading of it.
   */
  const owners = await resolveTokenAccountOwners(allTokenAccounts, deadline);
  const programs = owners.ok
    ? await resolveOwnerPrograms([...new Set(owners.ownerOf.values())], deadline)
    : { ok: false as const, programOf: new Map<string, string>() };

  const custodyUnreadable =
    allTokenAccounts.length > 0 && (!owners.ok || !programs.ok)
      ? "LP holder custody could not be resolved"
      : null;

  // --- 6. Classify and measure.
  return pairs.map((pair) => {
    const address = pair.pairAddress as string;
    const failure = failures.get(address);
    if (failure) return unmeasuredPool(pair, failure);

    const lpMint = lpMintByPair.get(address) as string;
    const mint = mintInfo.get(lpMint) as { supply: bigint; decimals: number };
    const largest = largestByMint.get(lpMint);

    if (!largest) {
      return unmeasuredPool(
        pair,
        "LP holder accounts could not be read within the time budget",
      );
    }
    if (mint.supply <= BigInt(0)) {
      return unmeasuredPool(pair, "LP mint has no supply outstanding");
    }
    if (custodyUnreadable) return unmeasuredPool(pair, custodyUnreadable);

    const holders: LpHolding[] = [];
    let burned = BigInt(0);
    let frozen = BigInt(0);
    let lockCustody = BigInt(0);
    let withdrawable = BigInt(0);
    let covered = BigInt(0);

    for (const account of largest) {
      const amount = toBigInt(account.amount);
      if (amount === null || amount <= BigInt(0)) continue;
      covered += amount;

      const owner = owners.ownerOf.get(account.address) ?? null;
      const ownerProgram = owner ? (programs.programOf.get(owner) ?? null) : null;
      const { custody, label } = classifyLpHolder(
        owner,
        ownerProgram,
        owners.stateOf.get(account.address) ?? null,
      );

      if (custody === "burned") burned += amount;
      else if (custody === "frozen") frozen += amount;
      else if (custody === "lock-program") lockCustody += amount;
      else withdrawable += amount;

      holders.push({
        tokenAccount: account.address,
        owner,
        share: shareOf(amount, mint.supply),
        custody,
        label,
      });
    }

    const unattributed = mint.supply > covered ? mint.supply - covered : BigInt(0);

    return {
      pairAddress: address,
      dexId: pair.dexId,
      liquidityUsd: pair.liquidityUsd,
      lpMint,
      unmeasuredReason: null,
      lpSupplyRaw: mint.supply.toString(),
      lpDecimals: mint.decimals,
      burnedFraction: shareOf(burned, mint.supply),
      frozenFraction: shareOf(frozen, mint.supply),
      lockCustodyFraction: shareOf(lockCustody, mint.supply),
      withdrawableFraction: shareOf(withdrawable, mint.supply),
      unattributedFraction: shareOf(unattributed, mint.supply),
      holders: holders.sort((a, b) => b.share - a.share),
    };
  });
}

// ---------------------------------------------------------------------------
// RPC plumbing
// ---------------------------------------------------------------------------

async function resolveTokenAccountOwners(
  tokenAccounts: string[],
  deadline: number,
): Promise<{
  ok: boolean;
  ownerOf: Map<string, string>;
  stateOf: Map<string, string>;
}> {
  const ownerOf = new Map<string, string>();
  const stateOf = new Map<string, string>();
  if (tokenAccounts.length === 0) return { ok: true, ownerOf, stateOf };

  try {
    const result = await withinBudget(
      getMultipleAccountsParsed<ParsedTokenAccountInfo>(tokenAccounts),
      deadline,
    );
    if (!result) return { ok: false, ownerOf, stateOf };

    result.value.forEach((account, index) => {
      const info = account?.data?.parsed?.info;
      if (info?.owner) ownerOf.set(tokenAccounts[index], info.owner);
      if (info?.state) stateOf.set(tokenAccounts[index], info.state);
    });
  } catch {
    return { ok: false, ownerOf, stateOf };
  }

  return { ok: true, ownerOf, stateOf };
}

async function resolveOwnerPrograms(
  owners: string[],
  deadline: number,
): Promise<{ ok: boolean; programOf: Map<string, string> }> {
  const programOf = new Map<string, string>();
  if (owners.length === 0) return { ok: true, programOf };

  try {
    const result = await withinBudget(getMultipleAccountOwners(owners), deadline);
    if (!result) return { ok: false, programOf };

    result.value.forEach((account, index) => {
      if (account) programOf.set(owners[index], account.owner);
    });
  } catch {
    return { ok: false, programOf };
  }

  return { ok: true, programOf };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unmeasuredPool(pair: MarketPair, reason: string): LiquiditySafetyPool {
  return {
    pairAddress: pair.pairAddress as string,
    dexId: pair.dexId,
    liquidityUsd: pair.liquidityUsd,
    lpMint: null,
    unmeasuredReason: reason,
    lpSupplyRaw: null,
    lpDecimals: null,
    burnedFraction: null,
    frozenFraction: null,
    lockCustodyFraction: null,
    withdrawableFraction: null,
    unattributedFraction: null,
    holders: [],
  };
}

/** Ratio of two base-unit amounts, in bigint so LP supplies cannot overflow. */
function shareOf(amount: bigint, total: bigint): number {
  if (total <= BigInt(0)) return 0;
  const PRECISION = BigInt(1_000_000_000);
  return Number((amount * PRECISION) / total) / 1_000_000_000;
}

function toBigInt(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function decodeBase64(value: unknown): Buffer | null {
  if (typeof value !== "string") return null;
  try {
    return Buffer.from(value, "base64");
  } catch {
    return null;
  }
}

/** Bytes to a base58 address, via the same key type the metadata reader uses. */
function encodePubkey(bytes: Uint8Array): string | null {
  try {
    return new PublicKey(bytes).toBase58();
  } catch {
    return null;
  }
}

/** Provider errors can be long; the reader only needs the gist. */
function truncateReason(reason: string): string {
  return reason.length > 120 ? `${reason.slice(0, 117)}...` : reason;
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

interface ParsedMintInfo {
  supply?: string;
  decimals?: number;
}

interface ParsedTokenAccountInfo {
  owner?: string;
  mint?: string;
  state?: string;
}
