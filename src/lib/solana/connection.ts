import { Connection } from "@solana/web3.js";

const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";

/**
 * Single shared RPC connection. Defaults to the public Solana mainnet
 * endpoint so the app works with zero setup. For reliable holder-concentration
 * data (getTokenLargestAccounts is aggressively throttled on the public
 * endpoint) set SOLANA_RPC_URL to a free-tier provider such as Helius,
 * QuickNode, or Alchemy — see README.md.
 */
export function getConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || DEFAULT_RPC_URL;
  return new Connection(rpcUrl, { commitment: "confirmed" });
}

/** Races a promise against a timeout so a slow/hanging RPC never hangs the request. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
