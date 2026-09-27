import { PROVIDER_TIMEOUT_MS } from "../market/policy";

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

export async function marketJson(url: string): Promise<{ body: unknown; fetchedAt: number; error: string | null }> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      headers: { Accept: "application/json" }, cache: "no-store",
    });
    if (!response.ok) return { body: null, fetchedAt: Date.now(), error: "Market service returned HTTP " + response.status };
    return { body: await response.json(), fetchedAt: Date.now(), error: null };
  } catch {
    // Public endpoint errors need no stack, request headers or runtime config in diagnostics.
    return { body: null, fetchedAt: Date.now(), error: "Market service unavailable or timed out" };
  }
}
