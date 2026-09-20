import { PublicKey } from "@solana/web3.js";
import { getConnection, withTimeout } from "./connection";

export interface HolderData {
  available: boolean;
  /** Largest token accounts by balance, as fraction of total supply (0-1), descending. */
  topAccountShares: number[];
  error?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetches the largest token accounts for a mint (top holder concentration).
 * getTokenLargestAccounts is heavily throttled on Solana's public RPC, so this
 * degrades gracefully (available: false) instead of failing the whole report.
 * Configure SOLANA_RPC_URL with a dedicated provider for reliable results.
 */
export async function getHolderData(mint: PublicKey, supplyRaw: string): Promise<HolderData> {
  const connection = getConnection();
  const totalSupply = BigInt(supplyRaw);

  if (totalSupply === BigInt(0)) {
    // Concentration is undefined when supply is zero (e.g. Solana's native
    // wSOL mint always reports supply "0" on-chain despite real circulation).
    return {
      available: false,
      topAccountShares: [],
      error: "Total supply reported as 0 — concentration percentage is undefined for this mint.",
    };
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await withTimeout(
        connection.getTokenLargestAccounts(mint, "confirmed"),
        10_000,
        "getTokenLargestAccounts",
      );
      const precision = BigInt(1_000_000);
      const shares = result.value
        .map((account) => Number((BigInt(account.amount) * precision) / totalSupply) / 1_000_000)
        .sort((a, b) => b - a);
      return { available: true, topAccountShares: shares };
    } catch (err) {
      lastError = err;
      if (attempt === 0) await sleep(750);
    }
  }

  const message = lastError instanceof Error ? lastError.message : "Unknown RPC error";
  return { available: false, topAccountShares: [], error: message };
}
