import "server-only";

import { getAccountInfoParsed } from "./rpc";
import { toUiAmount } from "./amounts";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./knownAddresses";

/**
 * Reads the SPL Token / Token-2022 mint account.
 *
 * `jsonParsed` encoding makes the RPC node decode both the base mint struct and
 * every Token-2022 extension, so no borsh layouts are maintained here.
 */

export interface TokenExtension {
  extension: string;
  state: Record<string, unknown>;
}

interface ParsedMintInfo {
  decimals: number;
  freezeAuthority: string | null;
  isInitialized: boolean;
  mintAuthority: string | null;
  supply: string;
  extensions?: TokenExtension[];
}

export interface MintInfo {
  address: string;
  tokenProgram: "spl-token" | "spl-token-2022";
  programId: string;
  decimals: number;
  /** Raw base-unit supply. Kept as a string because it can exceed 2^53. */
  supplyRaw: string;
  /** Supply in whole tokens. Precision is sufficient for risk ratios. */
  supplyUi: number;
  /**
   * `false` when the reported supply cannot be used as a denominator.
   *
   * Native wrapped SOL is the important case: its mint always reports
   * `supply: "0"` regardless of real circulation, which would otherwise turn
   * every concentration ratio into a division by zero.
   */
  supplyIsMeaningful: boolean;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  isInitialized: boolean;
  extensions: TokenExtension[];
  slot: number;
}

export class AccountNotFoundError extends Error {
  constructor(address: string) {
    super(`No account exists at ${address} on Solana mainnet.`);
    this.name = "AccountNotFoundError";
  }
}

export { toUiAmount };

export class NotAMintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotAMintError";
  }
}

export async function getMintInfo(address: string): Promise<MintInfo> {
  const { context, value } = await getAccountInfoParsed<ParsedMintInfo>(address);

  if (!value) throw new AccountNotFoundError(address);

  if (value.owner !== TOKEN_PROGRAM_ID && value.owner !== TOKEN_2022_PROGRAM_ID) {
    throw new NotAMintError(
      "This address is not an SPL Token mint (it is not owned by the Token or Token-2022 program). It may be a wallet, a program, or another kind of account.",
    );
  }

  if (value.data?.parsed?.type !== "mint") {
    throw new NotAMintError(
      "This address belongs to the Token program but is a token account, not a token mint. Paste the mint address instead.",
    );
  }

  const info = value.data.parsed.info;
  const supplyRaw = info.supply ?? "0";

  return {
    address,
    tokenProgram: value.owner === TOKEN_2022_PROGRAM_ID ? "spl-token-2022" : "spl-token",
    programId: value.owner,
    decimals: info.decimals,
    supplyRaw,
    supplyUi: toUiAmount(supplyRaw, info.decimals),
    supplyIsMeaningful: BigInt(supplyRaw) > BigInt(0),
    mintAuthority: info.mintAuthority ?? null,
    freezeAuthority: info.freezeAuthority ?? null,
    isInitialized: info.isInitialized,
    extensions: info.extensions ?? [],
    slot: context.slot,
  };
}

/** Look up a parsed Token-2022 extension by name. */
export function findExtension(
  mint: Pick<MintInfo, "extensions">,
  name: string,
): TokenExtension | undefined {
  return mint.extensions.find((extension) => extension.extension === name);
}
