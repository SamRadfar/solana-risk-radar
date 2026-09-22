import "server-only";

import {
  getMultipleAccountOwners,
  getMultipleAccountsParsed,
  getTokenLargestAccounts,
  type TokenLargestAccount,
} from "./rpc";
import { classifyHolder, type HolderKind } from "./knownAddresses";
import {
  deriveControl,
  orderAttributes,
  type ControlEvidence,
  type HolderAttribute,
  type TokenAccountState,
} from "./holderControl";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./knownAddresses";
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
 *
 * Accounts are then **aggregated by owner**. `getTokenLargestAccounts` returns
 * token accounts, and one wallet may hold several — counted separately they
 * understate how much a single actor controls, which is the error that matters
 * here.
 *
 * Finally each holder is given a control structure: multisig, lock, vesting,
 * vault, or nothing at all. See `holderControl` — every attribute comes from an
 * on-chain fact, and a holder that cannot be explained stays `Unknown`.
 */

export interface Holder {
  /** The token account address, or the first of several for this owner. */
  tokenAccount: string;
  /** The wallet or PDA that owns the token account. */
  owner: string | null;
  amountRaw: string;
  amountUi: number;
  /** Share of total supply, 0-1. */
  share: number;
  kind: HolderKind;
  label: string | null;
  /** How many token accounts this owner's holding was aggregated from. */
  accountCount: number;
  /** Verified control structure. Empty only when nothing could be read. */
  attributes: HolderAttribute[];
  /** Decoded m-of-n, when readable. */
  multisig: { threshold: number; signers: number } | null;
  /**
   * Share of total supply in this holding that provably cannot move — today,
   * only what sits in a frozen token account.
   */
  lockedShare: number;
  /** Share that is transferable now: `share` minus what is verifiably locked. */
  liquidShare: number;
  /** Why each attribute was assigned. */
  evidence: ControlEvidence[];
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
  /**
   * Largest sellable holder's share after verified restrictions are removed.
   *
   * Equal to `topHolderShare` unless some of that holding is provably
   * immobilised, so the raw figure is never replaced — only accompanied.
   */
  effectiveTopHolderShare: number | null;
  /** Total share of circulating supply under a verified, enforced lock. */
  verifiedLockedShare: number;
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
  effectiveTopHolderShare: null,
  verifiedLockedShare: 0,
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
      effectiveTopHolderShare: 0,
      verifiedLockedShare: 0,
      topHolderShare: 0,
      top10Share: 0,
      next9Share: 0,
    };
  }

  // Resolve each token account to its owner, then classify each owner by the
  // program that owns it. Batched, regardless of holder count.
  const owners = await resolveOwners(largest.map((account) => account.address));

  const totalRaw = BigInt(mint.supplyRaw);

  /*
   * Aggregate by owner before anything is measured.
   *
   * One wallet splitting a holding across several token accounts would
   * otherwise appear as several smaller holders, understating exactly the
   * concentration this analysis exists to find. Accounts whose owner could not
   * be resolved are keyed by their own address, so they are never merged with
   * each other on the strength of a shared failure.
   */
  const grouped = new Map<string, { accounts: typeof largest; owner: string | null }>();
  for (const account of largest) {
    const owner = owners.get(account.address)?.owner ?? null;
    const key = owner ?? `account:${account.address}`;
    const existing = grouped.get(key);
    if (existing) existing.accounts.push(account);
    else grouped.set(key, { accounts: [account], owner });
  }

  const holders: Holder[] = [...grouped.values()].map(({ accounts, owner }) => {
    const resolved = owners.get(accounts[0].address);
    const { kind, label } = owner
      ? classifyHolder(owner, resolved?.ownerProgram ?? null, resolved?.executable ?? false)
      : { kind: "wallet" as HolderKind, label: null };

    const amountRaw = accounts
      .reduce((sum, account) => sum + BigInt(account.amount), BigInt(0))
      .toString();

    /*
     * A freeze applies to a token account, not to an owner, so a holding split
     * across accounts can be partly frozen. Each account contributes its own
     * balance to the locked total.
     */
    let lockedRaw = BigInt(0);
    const attributes: HolderAttribute[] = [];
    const evidence: ControlEvidence[] = [];
    let multisig: { threshold: number; signers: number } | null = null;

    for (const account of accounts) {
      const meta = owners.get(account.address);
      const control = deriveControl({
        kind,
        ownerProgram: meta?.ownerProgram ?? null,
        ownerExecutable: meta?.executable ?? false,
        state: meta?.state ?? null,
        amountRaw: account.amount,
        splMultisig: meta?.splMultisig ?? null,
      });

      lockedRaw += BigInt(control.lockedRaw);
      multisig = multisig ?? control.multisig;
      for (const attribute of control.attributes) {
        if (!attributes.includes(attribute)) attributes.push(attribute);
      }
      for (const item of control.evidence) {
        if (!evidence.some((e) => e.attribute === item.attribute && e.source === item.source)) {
          evidence.push(item);
        }
      }
    }

    /*
     * "Unknown" survives unless something beyond the account model was
     * established. A wallet is still an unknown wallet.
     */
    const explained = attributes.some((attribute) =>
      (
        ["multisig", "locked", "lock-program", "liquidity-pool", "exchange", "burned"] as const
      ).includes(attribute as never),
    );
    const resolvedAttributes = explained
      ? attributes.filter((a) => a !== "unknown")
      : attributes;

    const share = shareOf(amountRaw, totalRaw);
    const lockedShare = shareOf(lockedRaw.toString(), totalRaw);

    return {
      tokenAccount: accounts[0].address,
      owner,
      amountRaw,
      amountUi: toUiAmount(amountRaw, mint.decimals),
      share,
      kind,
      label,
      accountCount: accounts.length,
      attributes: orderAttributes(resolvedAttributes),
      multisig,
      lockedShare,
      liquidShare: Math.max(0, share - lockedShare),
      evidence,
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
    /*
     * Effective liquid concentration: the largest position that could actually
     * be sold right now, minus only what is verifiably immobilised. It never
     * replaces the raw figure — both are reported, because a locked 25% is
     * still 25% of the supply.
     *
     * Taken as the maximum liquid share across holders, not the liquid share of
     * the largest holder. The two differ whenever the biggest position is also
     * the more restricted one: a holder with 50% of which 45% is frozen has
     * less to sell than one holding 30% outright, and reporting 5% there would
     * understate the real exposure — the precise false reassurance this
     * analysis exists to prevent.
     */
    effectiveTopHolderShare:
      dumpable.length > 0
        ? rebase(Math.max(...dumpable.map((holder) => holder.liquidShare)))
        : 0,
    verifiedLockedShare: rebase(
      dumpable.reduce((sum, holder) => sum + holder.lockedShare, 0),
    ),
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
  /** This token account's own state; `frozen` is an enforced restriction. */
  state: TokenAccountState | null;
  /** Decoded SPL multisig, when the owner account turned out to be one. */
  splMultisig: { threshold: number; signers: number } | null;
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
    const stateByTokenAccount = new Map<string, TokenAccountState>();
    value.forEach((account, index) => {
      const info = account?.data?.parsed?.info;
      if (info?.owner) ownerByTokenAccount.set(tokenAccounts[index], info.owner);
      if (info?.state) stateByTokenAccount.set(tokenAccounts[index], info.state);
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

    /*
     * An owner that is itself owned by a token program may be an SPL multisig
     * rather than a wallet. Only those are re-read, and only parsed, so the
     * extra call is skipped entirely for the ordinary case.
     */
    const multisigCandidates = uniqueOwners.filter((owner) => {
      const program = programByOwner.get(owner)?.program;
      return program === TOKEN_PROGRAM_ID || program === TOKEN_2022_PROGRAM_ID;
    });
    const multisigByOwner = await decodeMultisigs(multisigCandidates);

    for (const [tokenAccount, owner] of ownerByTokenAccount) {
      const meta = programByOwner.get(owner);
      result.set(tokenAccount, {
        owner,
        ownerProgram: meta?.program ?? null,
        executable: meta?.executable ?? false,
        state: stateByTokenAccount.get(tokenAccount) ?? null,
        splMultisig: multisigByOwner.get(owner) ?? null,
      });
    }
  } catch {
    return result;
  }

  return result;
}

/**
 * Reads SPL token multisig accounts, which `jsonParsed` decodes natively.
 *
 * This is the one multisig configuration that can be read without a program's
 * own layout, so it is the only one whose threshold is ever displayed. Other
 * multisig programs are recognised by their program id and reported without a
 * threshold rather than with a guessed one.
 */
async function decodeMultisigs(
  owners: string[],
): Promise<Map<string, { threshold: number; signers: number }>> {
  const result = new Map<string, { threshold: number; signers: number }>();
  if (owners.length === 0) return result;

  try {
    const { value } = await getMultipleAccountsParsed<ParsedMultisigInfo>(owners);
    value.forEach((account, index) => {
      const parsed = account?.data?.parsed;
      if (parsed?.type !== "multisig") return;
      const info = parsed.info;
      const threshold = Number(info?.numRequiredSigners);
      const signers = Number(info?.numValidSigners ?? info?.signers?.length);
      if (Number.isInteger(threshold) && Number.isInteger(signers) && threshold > 0) {
        result.set(owners[index], { threshold, signers });
      }
    });
  } catch {
    // A failed read means no multisig claim is made, which is the safe default.
  }

  return result;
}

interface ParsedTokenAccountInfo {
  owner: string;
  mint: string;
  state?: TokenAccountState;
}

interface ParsedMultisigInfo {
  numRequiredSigners?: number;
  numValidSigners?: number;
  signers?: string[];
}
