import { PublicKey } from "@solana/web3.js";
import { getConnection, withTimeout } from "./connection";

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export interface MintInfo {
  decimals: number;
  supplyRaw: string;
  supplyUi: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  isInitialized: boolean;
  tokenProgram: "spl-token" | "spl-token-2022";
}

export class NotAMintError extends Error {}
export class AccountNotFoundError extends Error {}

/** Fetches and parses an SPL Token / Token-2022 mint account. Throws for non-mint accounts. */
export async function getMintInfo(mint: PublicKey): Promise<MintInfo> {
  const connection = getConnection();
  const accountInfo = await withTimeout(
    connection.getParsedAccountInfo(mint, "confirmed"),
    12_000,
    "getParsedAccountInfo",
  );

  if (!accountInfo.value) {
    throw new AccountNotFoundError("No account exists at this address on Solana mainnet.");
  }

  const { data, owner } = accountInfo.value;
  const ownerStr = owner.toBase58();

  if (ownerStr !== TOKEN_PROGRAM_ID && ownerStr !== TOKEN_2022_PROGRAM_ID) {
    throw new NotAMintError(
      "This address is not an SPL Token mint (it is not owned by the Token or Token-2022 program).",
    );
  }

  if (typeof data === "string" || !("parsed" in data) || data.parsed?.type !== "mint") {
    throw new NotAMintError("This address is not a token mint account.");
  }

  const info = data.parsed.info as {
    decimals: number;
    supply: string;
    mintAuthority: string | null;
    freezeAuthority: string | null;
    isInitialized: boolean;
  };

  const supplyUi = Number(info.supply) / 10 ** info.decimals;

  return {
    decimals: info.decimals,
    supplyRaw: info.supply,
    supplyUi,
    mintAuthority: info.mintAuthority ?? null,
    freezeAuthority: info.freezeAuthority ?? null,
    isInitialized: info.isInitialized,
    tokenProgram: ownerStr === TOKEN_PROGRAM_ID ? "spl-token" : "spl-token-2022",
  };
}
