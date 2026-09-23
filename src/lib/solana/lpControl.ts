import { BURN_ADDRESSES, SYSTEM_PROGRAM_ID } from "./knownAddresses";
import type { LpCustodyClass } from "../risk-engine/types";

/**
 * LP custody registries and classification.
 *
 * Deliberately pure — no RPC, no `server-only` — so the classification that
 * decides whether liquidity counts as locked can be tested directly. The
 * fetching that feeds it lives in `lpCustody`, exactly as `holderControl` sits
 * beneath `holders`.
 *
 * The distinction this module exists to hold is the same one the holder
 * analysis makes: **custody is not a lock**. An LP holding sitting in a lock
 * program is disclosed as such, but its release schedule is not readable, so
 * it never counts toward locked liquidity. Only a burn (unredeemable by
 * construction) or a frozen token account (enforced by the token program and
 * readable here) does.
 */

/**
 * Pool-account layouts whose LP mint pubkey sits at a fixed offset.
 *
 * Every offset was validated against live mainnet pools: the pubkey read back
 * was confirmed to be an initialised mint account. Raydium's are further
 * corroborated by their LP mint authorities resolving to Raydium's own program
 * PDAs, and Pump.fun's by its LP mint authority being the pool account itself.
 *
 * Account sizes are deliberately *not* pinned. Meteora's Dynamic AMM pool
 * account was observed at 944, 952 and 1387 bytes across live pools while the
 * LP mint stayed at offset 8, so requiring an exact size would drop real pools
 * for no gain. The mint-validation step in `lpCustody` is what makes a wrong
 * offset fail safe.
 */
export const LP_MINT_LAYOUTS: Record<string, { name: string; offset: number }> = {
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": {
    name: "Raydium AMM v4",
    offset: 464,
  },
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: {
    name: "Raydium CPMM",
    offset: 136,
  },
  Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB: {
    name: "Meteora Dynamic AMM",
    offset: 8,
  },
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: {
    name: "Pump.fun AMM",
    offset: 107,
  },
  "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP": {
    name: "Orca Swap v2",
    offset: 99,
  },
};

/**
 * Venues with no fungible LP token.
 *
 * Concentrated-liquidity AMMs issue position NFTs with individual price
 * ranges, and bonding curves hold reserves in the program itself — in neither
 * case is there an LP supply to take a share of. Named individually so the
 * reason shown to the reader is specific rather than "unknown", because on an
 * established token these pools are usually most of the market and the reader
 * needs to know that is why coverage is low.
 */
export const NO_LP_TOKEN_PROGRAMS: Record<string, string> = {
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: "Orca Whirlpool",
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: "Raydium CLMM",
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: "Meteora DLMM",
  cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG: "Meteora DAMM v2",
  dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN: "Meteora DBC",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": "Pump.fun bonding curve",
};

/**
 * Programs that custody LP tokens under a lock.
 *
 * Membership proves custody, not immobility: the unlock time lives in the
 * program's own account layout and is not decoded here. So these produce
 * `lock-program`, which is disclosed to the reader and kept out of the locked
 * percentage.
 */
export const LP_LOCK_PROGRAM_IDS: Record<string, string> = {
  Lock1zcQFoaZmTk59sr9pB5daFE6Cs1K5eWyRLF1eju: "Raydium LP lock",
  LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn: "Jupiter Lock",
  strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m: "Streamflow",
  CChTq6PthWU82YZkbveA3WDf7s97BWhBK4Vx9bmsT743: "Bonfida token vesting",
};

/**
 * Farm and staking programs.
 *
 * LP deposited in a farm is earning yield, not locked — the depositor can
 * withdraw whenever they choose. Classified separately so it is never
 * mistaken for a lock, and counted as withdrawable, which is what it is.
 */
export const LP_STAKING_PROGRAM_IDS: Record<string, string> = {
  FarmuwXPWXvefWUeqFAa5w6rifLkq5X6E8bimYvrhCB1: "Meteora Farm",
  "9KEPoZmtHUrBbhWN1v1KWLMkkvwY6WLtAVUCPRtRjP4z": "Raydium Farm",
  EhYXq3ANp5nAerUpbSgd7VK2RRcxK1zNuSQ755G5Mtxx: "Raydium Farm v3",
  "5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h": "Stake Pool",
};

/**
 * Classify one LP holding from on-chain facts alone.
 *
 * Mirrors the holder analysis: the program that owns the holding account is
 * the evidence, and an account that cannot be explained stays `unknown` —
 * which counts as withdrawable, because assuming otherwise would invent a lock
 * that was never verified. There is no branch anywhere that looks at which
 * token is being analysed.
 */
export function classifyLpHolder(
  owner: string | null,
  ownerProgram: string | null,
  state: string | null,
): { custody: LpCustodyClass; label: string | null } {
  if (owner && BURN_ADDRESSES[owner]) {
    return { custody: "burned", label: BURN_ADDRESSES[owner] };
  }
  if (ownerProgram && LP_LOCK_PROGRAM_IDS[ownerProgram]) {
    return { custody: "lock-program", label: LP_LOCK_PROGRAM_IDS[ownerProgram] };
  }
  /*
   * A frozen LP account cannot be transferred, and unlike lock-program custody
   * the restriction is enforced by the token program and readable here — so
   * this is the one case besides a burn that counts toward locked.
   */
  if (state === "frozen") {
    return { custody: "frozen", label: "Frozen LP account" };
  }
  if (ownerProgram && LP_STAKING_PROGRAM_IDS[ownerProgram]) {
    return { custody: "staked", label: LP_STAKING_PROGRAM_IDS[ownerProgram] };
  }
  if (ownerProgram && ownerProgram !== SYSTEM_PROGRAM_ID) {
    return { custody: "program", label: null };
  }
  if (owner) return { custody: "wallet", label: null };
  return { custody: "unknown", label: null };
}
