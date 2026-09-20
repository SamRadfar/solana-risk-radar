import { PublicKey } from "@solana/web3.js";

export interface AddressValidationResult {
  valid: boolean;
  publicKey?: PublicKey;
  error?: string;
}

/** Validates that a string is a well-formed base58 Solana address (32-byte public key). */
export function validateSolanaAddress(input: string): AddressValidationResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return { valid: false, error: "Enter a token mint address." };
  }

  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
    return {
      valid: false,
      error: "That doesn't look like a Solana address (expected 32-44 base58 characters).",
    };
  }

  try {
    const publicKey = new PublicKey(trimmed);
    return { valid: true, publicKey };
  } catch {
    return { valid: false, error: "Invalid Solana address — could not decode base58 public key." };
  }
}
