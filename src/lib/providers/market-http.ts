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

interface MarketResponse { body: unknown; fetchedAt: number; error: string | null; events: string[]; cached?: boolean }
export interface MarketRequestOptions {
  /** Optional context (e.g. the 4h chart). Never spends a rate-limited host's budget. */
  optional?: boolean;
}
const pending = new Map<string, Promise<MarketResponse>>();
const MAX_RETRY_DELAY_MS = 1500;
/**
 * After a 429 without a usable Retry-After, stop sending to that host for this
 * long: GeckoTerminal answers "Retry-After: 0" yet stays limited for ~20 s
 * (measured 2026-09-28), and immediate retries only extend the penalty.
 */
export const RATE_LIMIT_COOLDOWN_MS = 20_000;
const cooldownUntil = new Map<string, number>();
const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };
function coolingDown(url: string): boolean {
  const until = cooldownUntil.get(hostOf(url));
  return until !== undefined && Date.now() < until;
}
/**
 * Last SUCCESSFUL response per exact URL. Reused only when the provider is
 * temporarily unavailable (429/5xx/timeout/cooldown), only while within the
 * existing snapshot freshness limit, and always with its ORIGINAL fetchedAt, so
 * downstream freshness checks judge it by its true age. Errors are never retained.
 */
const retained = new Map<string, { body: unknown; fetchedAt: number }>();
const MAX_RETAINED = 256;
function retain(url: string, body: unknown, fetchedAt: number) {
  if (body === null || typeof body !== "object") return;
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
function reuse(url: string, reason: string, events: string[]): MarketResponse | null {
  const kept = stillFresh(url);
  return kept ? { body: kept.body, fetchedAt: kept.fetchedAt, error: null, cached: true,
    events: [...events, `${reason}; reused a successful response from ${Math.round((Date.now() - kept.fetchedAt) / 1000)}s earlier (within the freshness limit)`] } : null;
}
/** Test hook. */
export function clearRetainedResponses() { retained.clear(); cooldownUntil.clear(); }

/** Concurrent identical reads share a promise, never a retained/stale response. */
export function marketJson(url: string, options: MarketRequestOptions = {}): Promise<MarketResponse> {
  const existing = pending.get(url);
  if (existing) return existing;
  const request = requestJson(url, options).finally(() => pending.delete(url));
  pending.set(url, request);
  return request;
}

async function requestJson(url: string, options: MarketRequestOptions): Promise<MarketResponse> {
  const events: string[] = [];
  if (coolingDown(url)) {
    const reason = "Provider rate limit cooldown";
    const kept = reuse(url, reason, events);
    if (kept) return kept;
    // Scored evidence may still try once; optional context never spends the budget.
    if (options.optional) return { body: null, fetchedAt: Date.now(), error: `${reason}; optional request skipped`, events };
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    let error: string, retry = true, temporary = true, delay = 250 + Math.floor(Math.random() * 250);
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        headers: { Accept: "application/json" }, cache: "no-store",
      });
      if (response.ok) {
        const body = await response.json(), fetchedAt = Date.now();
        retain(url, body, fetchedAt);
        cooldownUntil.delete(hostOf(url));
        return { body, fetchedAt, error: null, events };
      }
      error = "Market service returned HTTP " + response.status;
      retry = temporary = response.status === 429 || response.status >= 500;
      const after = response.headers.get("retry-after");
      const afterMs = after === null ? null : /^\d+(\.\d+)?$/.test(after) ? Number(after) * 1000 : Date.parse(after) - Date.now();
      if (response.status === 429) {
        // An explicit "Retry-After: 0" is not guidance (GeckoTerminal sends it while
        // still limiting): cool down instead of re-hitting the host. An absent
        // header still allows the one short bounded retry.
        cooldownUntil.set(hostOf(url), Date.now() + (afterMs !== null && Number.isFinite(afterMs) && afterMs > 0 ? afterMs : RATE_LIMIT_COOLDOWN_MS));
        if (afterMs !== null && Number.isFinite(afterMs) && afterMs <= 0) retry = false;
      }
      if (afterMs !== null && Number.isFinite(afterMs)) delay = Math.max(delay, afterMs);
    } catch {
      error = "Market service unavailable or timed out";
    }
    // Temporary failure: a still-fresh success is better evidence than nothing.
    const kept = temporary ? reuse(url, error, events) : null;
    if (kept) return kept;
    // Bounded: at most one retry, never before a long Retry-After, never for optional context.
    if (attempt === 1 || !retry || options.optional || delay > MAX_RETRY_DELAY_MS)
      return { body: null, fetchedAt: Date.now(), error, events };
    events.push(error + "; bounded retry");
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  throw new Error("Unreachable retry state");
}
