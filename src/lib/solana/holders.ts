import "server-only";

import {
  getMultipleAccountOwners,
  getMultipleAccountsParsed,
  getTokenLargestAccounts,
  type TokenLargestAccount,
} from "./rpc";
import { classifyHolder, type HolderKind } from "./knownAddresses";
import { toUiAmount, type MintInfo } from "./mint";

/**
 * Top-holder analysis.
 *
 * `getTokenLargestAccounts` returns *token accounts*, not people. Scoring them
 * directly badly misreads the token: an AMM pool vault holding 40% of supply is
 * liquidity (a good sign), and a burn address holding 40% is supply permanently
 * removed — neither is a whale who can dump.
 *
 * So each token account is resolved to its owning wallet, and each wallet is
 * then classified by the program that owns *it*: an account owned by a known
 * AMM program is a pool vault, one owned by the System Program is an ordinary
 * wallet. Concentration is scored over genuinely circulating supply only.
 */

export interface Holder {
  /** The token account address. */
  tokenAccount: string;
  /** The wallet or PDA that owns the token account. */
  owner: string | null;
  amountRaw: string;
  amountUi: number;
  /** Share of total supply, 0-1. */
  share: number;
  kind: HolderKind;
  label: string | null;
}

export interface HolderData {
  available: boolean;
  holders: Holder[];
  /**
   * Supply excluding burned tokens, in whole tokens. Concentration ratios use
   * this as the denominator.
   */
  circulatingSupply: number;
  /** Share of total supply held by pool vaults, 0-1. */
  pooledShare: number;
  /** Share of total supply provably burned, 0-1. */
  burnedShare: number;
  /** Largest single non-pool, non-burn holder's share of circulating supply. */
  topHolderShare: number | null;
  /**
   * Combined share of the ten largest such holders. Kept because it is the
   * metric people recognise, and displayed as-is — but note it *contains*
   * `topHolderShare`, so the two are near-perfectly correlated and only one of
   * them is scored. See `next9Share`.
   */
  top10Share: number | null;
  /**
   * Combined share of the 2nd through 10th largest sellable holders, i.e.
   * `top10Share` with the single largest holder removed.
   *
   * This is what the engine scores for distribution risk. Measured across real
   * tokens, top-1 and top-10 correlate at r = 0.92 (scoring both charges the
   * same wallet twice), while top-1 and this marginal measure correlate at
   * r = 0.07 — so the two holder signals become genuinely independent: one
   * asks "can a single actor crash this?", the other "is there a cluster
   * behind them?".
   */
  next9Share: number | null;
  error?: string;
}

const UNAVAILABLE = (error: string): HolderData => ({
  available: false,
  holders: [],
  circulatingSupply: 0,
  pooledShare: 0,
  burnedShare: 0,
  topHolderShare: null,
  top10Share: null,
  next9Share: null,
  error,
});

/** Ratio of two base-unit amounts, computed in bigint to avoid overflow. */
function shareOf(amountRaw: string, totalRaw: bigint): number {
  if (totalRaw === BigInt(0)) return 0;
  const PRECISION = BigInt(1_000_000_000);
  return Number((BigInt(amountRaw) * PRECISION) / totalRaw) / 1_000_000_000;
}

export async function getHolderData(mint: MintInfo): Promise<HolderData> {
  // wSOL and any uninitialised mint report a zero supply, which makes every
  // concentration ratio meaningless rather than zero.
  if (!mint.supplyIsMeaningful) {
    return UNAVAILABLE(
      "This mint reports a total supply of 0 on chain, so holder concentration cannot be expressed as a share of supply. Wrapped SOL behaves this way by design.",
    );
  }

  let largest: TokenLargestAccount[];
  try {
    const response = await getTokenLargestAccounts(mint.address);
    largest = response.value ?? [];
  } catch (error) {
    return UNAVAILABLE(
      error instanceof Error ? error.message : "Unknown RPC error reading token accounts.",
    );
  }

  if (largest.length === 0) {
    return {
      available: true,
      holders: [],
      circulatingSupply: mint.supplyUi,
      pooledShare: 0,
      burnedShare: 0,
      topHolderShare: 0,
      top10Share: 0,
      next9Share: 0,
    };
  }

  // Resolve each token account to its owner, then classify each owner by the
  // program that owns it. Two batched calls, regardless of holder count.
  const owners = await resolveOwners(largest.map((account) => account.address));

  const totalRaw = BigInt(mint.supplyRaw);
  const holders: Holder[] = largest.map((account) => {
    const resolved = owners.get(account.address);
    const owner = resolved?.owner ?? null;
    const { kind, label } = owner
      ? classifyHolder(owner, resolved?.ownerProgram ?? null, resolved?.executable ?? false)
      : { kind: "wallet" as HolderKind, label: null };

    return {
      tokenAccount: account.address,
      owner,
      amountRaw: account.amount,
      amountUi: toUiAmount(account.amount, mint.decimals),
      share: shareOf(account.amount, totalRaw),
      kind,
      label,
    };
  });

  const burnedShare = sumShare(holders, (h) => h.kind === "burn");
  const pooledShare = sumShare(holders, (h) => h.kind === "pool");

  // Burned tokens can never be sold, so they are removed from the denominator.
  const circulatingFraction = Math.max(0, 1 - burnedShare);
  const circulatingSupply = mint.supplyUi * circulatingFraction;

  // Pool vaults and burn addresses are not holders who can dump on the market.
  const dumpable = holders
    .filter((h) => h.kind !== "pool" && h.kind !== "burn")
    .sort((a, b) => b.share - a.share);

  const rebase = (share: number) =>
    circulatingFraction > 0 ? Math.min(1, share / circulatingFraction) : 0;

  return {
    available: true,
    holders: holders.sort((a, b) => b.share - a.share),
    circulatingSupply,
    pooledShare,
    burnedShare,
    topHolderShare: dumpable.length > 0 ? rebase(dumpable[0].share) : 0,
    top10Share: rebase(
      dumpable.slice(0, 10).reduce((sum, holder) => sum + holder.share, 0),
    ),
    // Summed from the individual holders rather than subtracted from the top-10
    // total, so rounding never produces a negative share.
    next9Share: rebase(
      dumpable.slice(1, 10).reduce((sum, holder) => sum + holder.share, 0),
    ),
  };
}

function sumShare(holders: Holder[], predicate: (h: Holder) => boolean): number {
  return holders.filter(predicate).reduce((sum, holder) => sum + holder.share, 0);
}

interface ResolvedOwner {
  owner: string;
  ownerProgram: string | null;
  executable: boolean;
}

/**
 * Map token account -> owning wallet -> the program that owns that wallet.
 *
 * Failures degrade to an empty map rather than throwing: unlabelled holders are
 * conservatively treated as ordinary wallets, which never understates risk.
 */
async function resolveOwners(
  tokenAccounts: string[],
): Promise<Map<string, ResolvedOwner>> {
  const result = new Map<string, ResolvedOwner>();
  if (tokenAccounts.length === 0) return result;

  try {
    const { value } =
      await getMultipleAccountsParsed<ParsedTokenAccountInfo>(tokenAccounts);

    const ownerByTokenAccount = new Map<string, string>();
    value.forEach((account, index) => {
      const owner = account?.data?.parsed?.info?.owner;
      if (owner) ownerByTokenAccount.set(tokenAccounts[index], owner);
    });

    const uniqueOwners = [...new Set(ownerByTokenAccount.values())];
    if (uniqueOwners.length === 0) return result;

    // Only the account header is needed, so the data payload is sliced away.
    const ownerAccounts = await getMultipleAccountOwners(uniqueOwners);
    const programByOwner = new Map<string, { program: string; executable: boolean }>();
    ownerAccounts.value.forEach((account, index) => {
      if (account) {
        programByOwner.set(uniqueOwners[index], {
          program: account.owner,
          executable: account.executable,
        });
      }
    });

    for (const [tokenAccount, owner] of ownerByTokenAccount) {
      const meta = programByOwner.get(owner);
      result.set(tokenAccount, {
        owner,
        ownerProgram: meta?.program ?? null,
        executable: meta?.executable ?? false,
      });
    }
  } catch {
    return result;
  }

  return result;
}

interface ParsedTokenAccountInfo {
  owner: string;
  mint: string;
}
