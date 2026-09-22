import type { HolderKind } from "./knownAddresses";

/**
 * Holder control structure.
 *
 * Raw concentration says how much an account holds. This says how dangerous
 * that concentration may be — whether a single key can move it, whether it is
 * under a program's custody, whether any part of it provably cannot move.
 *
 * Everything here is derived from on-chain facts: the program that owns the
 * account, decoded multisig state, and the token account's own frozen flag.
 * Nothing is inferred from balance size, inactivity, the token's fame, or its
 * name. An address that cannot be explained is `Unknown`, and stays `Unknown`.
 */

export type HolderAttribute =
  | "wallet"
  | "unknown"
  | "multisig"
  | "locked"
  | "lock-program"
  | "program-vault"
  | "liquidity-pool"
  | "exchange"
  | "burned";

/**
 * How a classification was established. Recorded for every attribute that can
 * move the score, so a verdict stays explicable after the fact.
 */
export interface ControlEvidence {
  attribute: HolderAttribute;
  /** Plain-language statement of what was checked. */
  method: string;
  /** The on-chain fact the classification rests on. */
  source: string;
}

export interface HolderControl {
  attributes: HolderAttribute[];
  evidence: ControlEvidence[];
  /** Decoded m-of-n, when the multisig program allows it to be read. */
  multisig: { threshold: number; signers: number } | null;
  /**
   * Base units in this account that provably cannot be transferred.
   *
   * Only ever set from a restriction that is enforced on chain and readable —
   * today that means a frozen token account. Custody by a vesting program is
   * disclosed as an attribute but is *not* counted here, because the release
   * schedule cannot be read generically and guessing it would overstate
   * safety.
   */
  lockedRaw: string;
}

/**
 * Multisig programs.
 *
 * Membership here says the allocation needs more than one signature to move.
 * It does not say the allocation is locked: a 4-of-7 can still sell today if
 * four signers agree.
 */
export const MULTISIG_PROGRAM_IDS: Record<string, string> = {
  SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu: "Squads v3",
  SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf: "Squads v4",
  msigmtwzgXJHj2ext4XJjCDmpbcMuufFb5cHy6v6zyt: "Mean Multisig",
  GoKi8zYBUbjGkSgWUzGe5NTZfWHfBeDMc2ZtmDJgWpaD: "Goki Smart Wallet",
};

/**
 * Lock and vesting programs.
 *
 * Custody by one of these is verifiable from the owning program id. The
 * schedule inside it is not — that needs the program's own layout — so these
 * produce the `lock-program` attribute and never `locked`.
 *
 * The distinction matters. `locked` is a claim that a balance cannot move, and
 * this product only makes it where the token program itself enforces it. Under
 * a lock program, some of the allocation may already be claimable, and calling
 * the whole thing "Locked" while counting none of it as locked would be
 * exactly the false reassurance this analysis is supposed to avoid.
 */
export const LOCK_PROGRAM_IDS: Record<string, string> = {
  strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m: "Streamflow",
  "5NGNQKUgZCuzLCd6mFqxmS1HdSyZpFccEPVBKYxwiWH1": "Streamflow (aligned unlocks)",
  CChTq6PthWU82YZkbveA3WDf7s97BWhBK4Vx9bmsT743: "Bonfida token vesting",
  LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn: "Jupiter Lock",
  "2r81MPMDjGSrbmGRwzDg6aqhe3t3vbKcrYfpes5bXckS": "Token vesting",
};

/** Staking and governance custody — a vault, not a wallet, and not a lock. */
export const VAULT_PROGRAM_IDS: Record<string, string> = {
  GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw: "SPL Governance",
  Stake11111111111111111111111111111111111111: "Stake Program",
  voTpMYvLXfJbNCbUyLZJ5iRbAxr1TkitX1WnAkPhhPQ: "Voter Stake Registry",
  MERLuDFBMmsHnsBPZw2sDQZHvXFMwp8EdjudcU2HKky: "Mercurial vault",
};

/** SPL token account state, as `jsonParsed` reports it. */
export type TokenAccountState = "initialized" | "frozen" | "uninitialized";

export interface ControlInputs {
  /** The coarse kind the existing address classification already produced. */
  kind: HolderKind;
  /** Program that owns the *owner* account. */
  ownerProgram: string | null;
  ownerExecutable: boolean;
  /** This token account's own state — `frozen` is an enforced restriction. */
  state: TokenAccountState | null;
  /** Balance in base units, used to express what a freeze immobilises. */
  amountRaw: string;
  /** Decoded SPL multisig, when the owner turned out to be one. */
  splMultisig: { threshold: number; signers: number } | null;
}

/**
 * Derives a holder's control structure from on-chain facts alone.
 *
 * Deliberately generic: there is no branch anywhere that looks at which mint is
 * being analysed. A treasury is recognised because a program owns it, never
 * because the token is famous.
 */
export function deriveControl(inputs: ControlInputs): HolderControl {
  const attributes: HolderAttribute[] = [];
  const evidence: ControlEvidence[] = [];
  let multisig: { threshold: number; signers: number } | null = null;
  let lockedRaw = "0";

  const add = (attribute: HolderAttribute, method: string, source: string) => {
    if (!attributes.includes(attribute)) attributes.push(attribute);
    evidence.push({ attribute, method, source });
  };

  // --- The coarse kind first: pools, burns and custodians are already settled.
  if (inputs.kind === "pool") {
    add(
      "liquidity-pool",
      "Token account is owned by a known AMM program",
      `Owner account program: ${inputs.ownerProgram ?? "unknown"}`,
    );
  } else if (inputs.kind === "burn") {
    add(
      "burned",
      "Holder address is a known unspendable or incinerator address",
      "Address registry",
    );
  } else if (inputs.kind === "custodian") {
    add(
      "exchange",
      "Holder address appears in the verified custodial address registry",
      "Address registry",
    );
  }

  // --- Control structure, from the program that owns the holding account.
  const program = inputs.ownerProgram;

  if (program && MULTISIG_PROGRAM_IDS[program]) {
    add(
      "multisig",
      "Holder account is owned by a known multisig program",
      `${MULTISIG_PROGRAM_IDS[program]} (${program})`,
    );
  }

  if (inputs.splMultisig) {
    multisig = inputs.splMultisig;
    add(
      "multisig",
      "Holder account decodes as an SPL token multisig",
      `${inputs.splMultisig.threshold}-of-${inputs.splMultisig.signers} signers required`,
    );
  }

  if (program && LOCK_PROGRAM_IDS[program]) {
    add(
      "lock-program",
      "Holding is custodied by a known lock or vesting program; the release schedule could not be read",
      `${LOCK_PROGRAM_IDS[program]} (${program})`,
    );
  }

  if (program && VAULT_PROGRAM_IDS[program]) {
    add(
      "program-vault",
      "Holder account is owned by a known staking or governance program",
      `${VAULT_PROGRAM_IDS[program]} (${program})`,
    );
  }

  /*
   * A frozen token account cannot transfer. This is the one restriction that
   * is both enforced by the token program and readable from the account, so
   * it is the only one allowed to reduce liquid exposure.
   */
  if (inputs.state === "frozen") {
    lockedRaw = inputs.amountRaw;
    add(
      "locked",
      "Token account is frozen by the mint's freeze authority",
      "Account state: frozen",
    );
  }

  // --- Whatever is left.
  if (attributes.length === 0) {
    if (inputs.kind === "contract" || inputs.ownerExecutable) {
      add(
        "program-vault",
        "Holder account is owned by an on-chain program rather than a wallet",
        `Owner account program: ${program ?? "unknown"}`,
      );
    } else {
      add("wallet", "Holder account is a system-owned wallet", "Owner program: System Program");
    }
  }

  /*
   * "Unknown" is a statement about this product's certainty, not about the
   * address. It is added whenever nothing beyond the account model could be
   * established — which is the ordinary case, and saying so is the point.
   */
  /*
   * "Wallet" and "program-vault" describe the account model, not an identity —
   * knowing an address is a wallet says nothing about who controls it. So
   * neither of them dismisses the uncertainty, and the ordinary case reads
   * "Wallet · Unknown", which is the honest description.
   */
  const explained = attributes.some((attribute) =>
    (
      ["multisig", "locked", "lock-program", "liquidity-pool", "exchange", "burned"] as const
    ).includes(attribute as never),
  );
  if (!explained) {
    add(
      "unknown",
      "No further identity or control structure could be verified",
      "No matching program, registry entry or on-chain restriction",
    );
  }

  return { attributes, evidence, multisig, lockedRaw };
}

/** Display order: the most decision-relevant attribute first. */
const ATTRIBUTE_ORDER: HolderAttribute[] = [
  "burned",
  "liquidity-pool",
  "exchange",
  "program-vault",
  "locked",
  "lock-program",
  "multisig",
  "wallet",
  "unknown",
];

export function orderAttributes(attributes: HolderAttribute[]): HolderAttribute[] {
  return [...attributes].sort(
    (a, b) => ATTRIBUTE_ORDER.indexOf(a) - ATTRIBUTE_ORDER.indexOf(b),
  );
}
