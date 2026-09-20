import "server-only";

/**
 * A tiny in-process TTL cache for completed reports.
 *
 * Scanning a large token's holder set is inherently slow on public RPC
 * (`getTokenLargestAccounts` takes several seconds for a token like USDC,
 * because the node walks a very large account set). Re-analysing the same mint
 * within the TTL is both wasteful and rude to a free endpoint.
 *
 * Deliberately a plain Map rather than a datastore: the cache is an
 * optimisation, not a source of truth. It may be cold on any request, entries
 * are never relied upon, and nothing breaks if the process restarts. That is
 * the whole reason this project needs no database.
 */

const TTL_MS = 60_000;
const MAX_ENTRIES = 200;

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();

export function getCached<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }

  // Refresh insertion order so the eviction below stays roughly LRU.
  store.delete(key);
  store.set(key, entry);
  return entry.value as T;
}

export function setCached<T>(key: string, value: T, ttlMs = TTL_MS): void {
  if (store.size >= MAX_ENTRIES) {
    // Map preserves insertion order, so the first key is the least recently used.
    const oldest = store.keys().next();
    if (!oldest.done) store.delete(oldest.value);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Exposed for tests. */
export function clearCache(): void {
  store.clear();
}
