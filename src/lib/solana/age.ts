import "server-only";

import { getSignaturesForAddress } from "./rpc";

/**
 * Age of the mint itself, derived from its transaction history.
 *
 * There is no RPC method that returns "when was this account created", so the
 * signature history is walked backwards to its oldest entry. That is unbounded
 * for an established token, so paging stops after a fixed number of pages and
 * reports a lower bound instead.
 *
 * This asymmetry is deliberate and is exactly the right trade-off for the
 * question being asked: a brand-new token — the case where age actually matters
 * — has a short history and resolves exactly on the first page. A token too
 * busy to page through is, by that very fact, not new.
 */

const PAGE_SIZE = 1000;
const MAX_PAGES = 2;

export interface TokenAge {
  available: boolean;
  /** Timestamp of the oldest transaction found, ms epoch. */
  oldestSignatureAt: number | null;
  ageDays: number | null;
  /**
   * `true` when paging stopped before reaching the beginning of history, so
   * `ageDays` is a minimum rather than the real age.
   */
  isLowerBound: boolean;
  signaturesScanned: number;
  error?: string;
}

const UNAVAILABLE = (error: string): TokenAge => ({
  available: false,
  oldestSignatureAt: null,
  ageDays: null,
  isLowerBound: false,
  signaturesScanned: 0,
  error,
});

export async function getTokenAge(mint: string): Promise<TokenAge> {
  try {
    let before: string | undefined;
    let oldestBlockTime: number | null = null;
    let scanned = 0;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const signatures = await getSignaturesForAddress(mint, {
        limit: PAGE_SIZE,
        before,
      });

      if (signatures.length === 0) break;
      scanned += signatures.length;

      // Signatures come back newest first, so the last entry is the oldest.
      for (let i = signatures.length - 1; i >= 0; i -= 1) {
        const blockTime = signatures[i].blockTime;
        if (typeof blockTime === "number" && blockTime > 0) {
          oldestBlockTime = blockTime;
          break;
        }
      }

      // A short page means we reached the beginning of history.
      if (signatures.length < PAGE_SIZE) {
        return finish(oldestBlockTime, scanned, false);
      }

      before = signatures[signatures.length - 1].signature;
    }

    return finish(oldestBlockTime, scanned, true);
  } catch (error) {
    return UNAVAILABLE(
      error instanceof Error ? error.message : "Unknown RPC error reading mint history.",
    );
  }
}

function finish(
  oldestBlockTime: number | null,
  scanned: number,
  isLowerBound: boolean,
): TokenAge {
  if (oldestBlockTime === null) {
    return UNAVAILABLE("No timestamped transaction history was returned for this mint.");
  }

  const oldestSignatureAt = oldestBlockTime * 1000;
  return {
    available: true,
    oldestSignatureAt,
    ageDays: (Date.now() - oldestSignatureAt) / (1000 * 60 * 60 * 24),
    isLowerBound,
    signaturesScanned: scanned,
  };
}
