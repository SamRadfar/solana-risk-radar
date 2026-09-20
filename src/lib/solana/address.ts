/**
 * Base58 (Bitcoin/Solana alphabet) decoding and mint-address validation.
 *
 * Implemented locally rather than pulled from a library so the exact same
 * validation can run in the browser (instant feedback) and on the server
 * (trust boundary) without shipping a crypto bundle to the client.
 */

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const INDEX: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  for (let i = 0; i < ALPHABET.length; i += 1) map[ALPHABET[i]] = i;
  return map;
})();

/** Decode a base58 string to bytes. Returns `null` for malformed input. */
export function decodeBase58(input: string): Uint8Array | null {
  if (input.length === 0) return null;

  const bytes: number[] = [0];
  for (const char of input) {
    const value = INDEX[char];
    if (value === undefined) return null;

    let carry = value;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Each leading '1' in base58 represents one leading zero byte.
  for (let i = 0; i < input.length && input[i] === '1'; i += 1) bytes.push(0);

  return new Uint8Array(bytes.reverse());
}

export type AddressValidation =
  | { valid: true; address: string }
  | { valid: false; reason: string };

/**
 * Validate that a string is a plausible Solana mint address: a base58-encoded
 * 32-byte public key. This is a structural check — it does not prove the
 * account exists on chain.
 */
export function validateMintAddress(raw: string): AddressValidation {
  const address = raw.trim();

  if (address.length === 0) {
    return { valid: false, reason: 'Enter a Solana token mint address.' };
  }
  if (address.length < 32 || address.length > 44) {
    return {
      valid: false,
      reason: 'A Solana address is 32–44 characters long.',
    };
  }

  const decoded = decodeBase58(address);
  if (decoded === null) {
    return {
      valid: false,
      reason: 'Contains characters that are not valid base58 (no 0, O, I or l).',
    };
  }
  if (decoded.length !== 32) {
    return { valid: false, reason: 'Not a valid 32-byte Solana public key.' };
  }

  return { valid: true, address };
}

/** Shorten an address for display: `EPjFWd…TDt1v`. */
export function shortenAddress(address: string, lead = 4, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}
