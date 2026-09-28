import { MAX_SNAPSHOT_AGE_MS, PROVIDER_TIMEOUT_MS } from "../market/policy";

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
export const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const string = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;
export function finite(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function positive(value: unknown): number | null {
  const number = finite(value);
  return number !== null && number > 0 ? number : null;
}
export function nonnegative(value: unknown): number | null {
  const number = finite(value);
  return number !== null && number >= 0 ? number : null;
}
export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? value : null; }
  catch { return null; }
}

interface MarketResponse { body: unknown; fetchedAt: number; error: string | null; events: string[] }
const pending = new Map<string, Promise<MarketResponse>>();
const MAX_RETRY_DELAY_MS = 1500;
/**
 * Last SUCCESSFUL response per URL. Used only when the provider temporarily
 * answers 429/503, only while still within the existing snapshot freshness
 * limit, and always with its ORIGINAL fetchedAt, so downstream freshness checks
 * judge it by its true age. Errors are never retained.
 */
const retained = new Map<string, { body: unknown; fetchedAt: number }>();
const MAX_RETAINED = 256;
function retain(url: string, body: unknown, fetchedAt: number) {
  retained.delete(url);
  retained.set(url, { body, fetchedAt });
  while (retained.size > MAX_RETAINED) retained.delete(retained.keys().next().value!);
}
function stillFresh(url: string): { body: unknown; fetchedAt: number } | null {
  const kept = retained.get(url);
  if (!kept) return null;
  if (Date.now() - kept.fetchedAt > MAX_SNAPSHOT_AGE_MS) { retained.delete(url); return null; }
  return kept;
}
/** Test hook. */
export function clearRetainedResponses() { retained.clear(); }

/** Concurrent identical reads share a promise, never a retained/stale response. */
export function marketJson(url: string): Promise<MarketResponse> {
  const existing = pending.get(url);
  if (existing) return existing;
  const request = requestJson(url).finally(() => pending.delete(url));
  pending.set(url, request);
  return request;
}

async function requestJson(url: string): Promise<MarketResponse> {
  const events: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let error: string, retry = true, delay = 250 + Math.floor(Math.random() * 250);
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        headers: { Accept: "application/json" }, cache: "no-store",
      });
      if (response.ok) {
        const body = await response.json(), fetchedAt = Date.now();
        retain(url, body, fetchedAt);
        return { body, fetchedAt, error: null, events };
      }
      error = "Market service returned HTTP " + response.status;
      retry = response.status === 429 || response.status === 503;
      // A temporary rate limit reuses a still-fresh success instead of spending another request.
      const kept = retry ? stillFresh(url) : null;
      if (kept) return { body: kept.body, fetchedAt: kept.fetchedAt, error: null,
        events: [...events, `${error}; reused a successful response from ${Math.round((Date.now() - kept.fetchedAt) / 1000)}s earlier (within the freshness limit)`] };
      const after = response.headers.get("retry-after");
      if (after !== null) {
        const ms = /^\d+(\.\d+)?$/.test(after) ? Number(after) * 1000 : Date.parse(after) - Date.now();
        if (Number.isFinite(ms)) delay = Math.max(delay, ms);
      }
    } catch {
      error = "Market service unavailable or timed out";
    }
    // Never retry before a long Retry-After; return missing evidence promptly.
    if (attempt === 1 || !retry || delay > MAX_RETRY_DELAY_MS)
      return { body: null, fetchedAt: Date.now(), error, events };
    events.push(error + "; bounded retry");
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  throw new Error("Unreachable retry state");
}
