import "server-only";

import { PublicKey } from "@solana/web3.js";

import { getAccountInfoBase64 } from "./rpc";
import { METAPLEX_METADATA_PROGRAM_ID } from "./knownAddresses";
import { findExtension, type MintInfo } from "./mint";

/**
 * Token identity, read from whichever metadata standard the mint uses.
 *
 * Token-2022 mints can carry metadata in a `tokenMetadata` extension on the
 * mint account itself; classic SPL tokens store it in a Metaplex PDA. Both are
 * read on chain, so token identity never depends on a third-party token list.
 *
 * `isMutable` / `updateAuthority` matter for risk, not just display: mutable
 * metadata means the name, symbol and off-chain URI can be changed after a
 * holder has bought in.
 */

export interface OnChainMetadata {
  name: string | null;
  symbol: string | null;
  uri: string | null;
  updateAuthority: string | null;
  /** `true` when name, symbol and URI can still be changed. */
  isMutable: boolean | null;
  source: "metaplex" | "token-2022" | "none";
  metadataAccount: string | null;
}

const METAPLEX_PROGRAM = new PublicKey(METAPLEX_METADATA_PROGRAM_ID);

export function metadataPda(mint: string): string {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METAPLEX_PROGRAM.toBuffer(), new PublicKey(mint).toBuffer()],
    METAPLEX_PROGRAM,
  )[0].toBase58();
}

/** Strip the null padding Metaplex writes into its fixed-width string fields. */
function clean(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.replace(/\0/g, "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface MetaplexMetadata {
  updateAuthority: string;
  name: string | null;
  symbol: string | null;
  uri: string | null;
  isMutable: boolean;
}

/**
 * Decode a Metaplex Token Metadata account (borsh).
 *
 * Layout: key(u8) | updateAuthority(32) | mint(32) | name(str) | symbol(str) |
 * uri(str) | sellerFeeBasisPoints(u16) | creators(Option<Vec<Creator>>) |
 * primarySaleHappened(bool) | isMutable(bool)
 *
 * Exported so it can be unit-tested against fixed byte buffers.
 */
export function decodeMetaplexMetadata(buffer: Buffer): MetaplexMetadata | null {
  try {
    let offset = 1; // skip the discriminator key

    const updateAuthority = new PublicKey(buffer.subarray(offset, offset + 32)).toBase58();
    offset += 32 + 32; // updateAuthority + mint

    const readString = (): string => {
      const length = buffer.readUInt32LE(offset);
      offset += 4;
      // Guard against a corrupt length driving a huge read.
      if (length > buffer.length) throw new Error("metadata string overflows account");
      const value = buffer.subarray(offset, offset + length).toString("utf8");
      offset += length;
      return value;
    };

    const name = clean(readString());
    const symbol = clean(readString());
    const uri = clean(readString());

    offset += 2; // sellerFeeBasisPoints

    const hasCreators = buffer.readUInt8(offset);
    offset += 1;
    if (hasCreators === 1) {
      const count = buffer.readUInt32LE(offset);
      offset += 4;
      offset += count * 34; // pubkey(32) + verified(1) + share(1)
    }

    offset += 1; // primarySaleHappened
    const isMutable = buffer.readUInt8(offset) === 1;

    return { updateAuthority, name, symbol, uri, isMutable };
  } catch {
    // A truncated or non-standard account is not an error worth failing the
    // whole report over; identity simply stays unknown.
    return null;
  }
}

const EMPTY: OnChainMetadata = {
  name: null,
  symbol: null,
  uri: null,
  updateAuthority: null,
  isMutable: null,
  source: "none",
  metadataAccount: null,
};

export async function getOnChainMetadata(mint: MintInfo): Promise<OnChainMetadata> {
  // Token-2022 mints may embed metadata directly on the mint account.
  const embedded = findExtension(mint, "tokenMetadata");
  if (embedded) {
    const state = embedded.state as {
      name?: string;
      symbol?: string;
      uri?: string;
      updateAuthority?: string | null;
    };
    return {
      name: clean(state.name),
      symbol: clean(state.symbol),
      uri: clean(state.uri),
      updateAuthority: state.updateAuthority ?? null,
      // The Token-2022 metadata interface has no explicit immutability flag:
      // metadata is mutable exactly while an update authority is set.
      isMutable: Boolean(state.updateAuthority),
      source: "token-2022",
      metadataAccount: mint.address,
    };
  }

  const pda = metadataPda(mint.address);
  const { value } = await getAccountInfoBase64(pda);
  if (!value) return EMPTY;

  const decoded = decodeMetaplexMetadata(Buffer.from(value.data[0], "base64"));
  if (!decoded) return { ...EMPTY, metadataAccount: pda };

  return {
    name: decoded.name,
    symbol: decoded.symbol,
    uri: decoded.uri,
    updateAuthority: decoded.updateAuthority,
    isMutable: decoded.isMutable,
    source: "metaplex",
    metadataAccount: pda,
  };
}
