import { PublicKey } from "@solana/web3.js";
import { getConnection, withTimeout } from "./connection";

const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

export interface OnChainMetadata {
  name: string | null;
  symbol: string | null;
  uri: string | null;
}

function readNext(buf: Buffer, cursor: { offset: number }): string {
  const len = buf.readUInt32LE(cursor.offset);
  const raw = buf.subarray(cursor.offset + 4, cursor.offset + 4 + len).toString("utf8");
  cursor.offset += 4 + len;
  return raw.replace(/\u0000/g, "").trim();
}

/**
 * Reads the Metaplex Token Metadata account for a mint directly from chain.
 * No API key required. Returns null fields (not a thrown error) when the
 * mint simply has no metadata account (common for unlisted / test tokens).
 */
export async function getOnChainMetadata(mint: PublicKey): Promise<OnChainMetadata> {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  );

  const connection = getConnection();
  const accountInfo = await withTimeout(
    connection.getAccountInfo(pda, "confirmed"),
    10_000,
    "getAccountInfo(metadata)",
  );

  if (!accountInfo) {
    return { name: null, symbol: null, uri: null };
  }

  try {
    const data = accountInfo.data;
    // Layout: 1 byte key + 32 byte update authority + 32 byte mint, then borsh strings.
    const cursor = { offset: 1 + 32 + 32 };
    const name = readNext(data, cursor);
    const symbol = readNext(data, cursor);
    const uri = readNext(data, cursor);
    return {
      name: name || null,
      symbol: symbol || null,
      uri: uri || null,
    };
  } catch {
    return { name: null, symbol: null, uri: null };
  }
}
