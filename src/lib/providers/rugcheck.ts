/**
 * RugCheck report summary — an external, independent security assessment.
 *
 * Contract: `GET https://api.rugcheck.xyz/v1/tokens/{mint}/report/summary`,
 * schema `dto.TokenCheckSummary` in https://api.rugcheck.xyz/swagger/doc.json
 * (verified 2026-09-27): `score`, `score_normalised`, `risks[]` (`name`,
 * `description`, `level`, `score`, `value`), `lpLockedPct`, `tokenProgram`,
 * `tokenType`, `error`. Only those documented fields are read.
 *
 * Everything that is not a well-formed report becomes `unavailable` with a
 * reason — never an empty (clean) report. One request, no retries.
 */

export const RUGCHECK_SOURCE = "RugCheck";
export const RUGCHECK_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_RISKS = 100;

export function rugCheckSummaryUrl(mint: string): string {
  return `https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report/summary`;
}

export interface RugCheckRisk {
  name: string;
  description: string;
  /** Provider level string, kept verbatim. Observed live: "warn", "danger". */
  level: string;
  score: number | null;
  value: string;
}

export interface RugCheckSummary {
  /** Provider headline score, 0-100. Context only; never an input to our score. */
  scoreNormalised: number | null;
  risks: RugCheckRisk[];
  /** Provider-reported LP locked share, 0-100. Context only. */
  lpLockedPct: number | null;
  /** Owning token program id as reported by RugCheck; null when not reported. */
  tokenProgram: string | null;
}

export type RugCheckResult =
  | { status: "ok"; summary: RugCheckSummary; httpStatus: number; latencyMs: number; fetchedAt: number }
  | { status: "unavailable"; reason: string; httpStatus: number | null; latencyMs: number | null; fetchedAt: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Provider text is untrusted: single line, bounded length. */
function clean(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const finiteOrNull = (value: unknown, min: number, max: number): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;

/** Validate a summary body. Any structural doubt fails closed. */
export function parseRugCheckSummary(body: unknown): { ok: true; summary: RugCheckSummary } | { ok: false; reason: string } {
  if (!isRecord(body)) return { ok: false, reason: "RugCheck returned a malformed response" };
  if (typeof body.error === "string" && body.error.trim()) {
    return { ok: false, reason: `RugCheck could not assess this mint: ${clean(body.error)}` };
  }
  if (!Array.isArray(body.risks)) return { ok: false, reason: "RugCheck response has no risks list (schema changed or report missing)" };
  if (body.risks.length > MAX_RISKS) return { ok: false, reason: "RugCheck response exceeded the supported number of findings" };
  const risks: RugCheckRisk[] = [];
  for (const entry of body.risks) {
    // A finding we cannot read could be the serious one; do not score a partial list.
    if (!isRecord(entry) || typeof entry.name !== "string" || !entry.name.trim() || typeof entry.level !== "string") {
      return { ok: false, reason: "RugCheck returned a finding without a readable name or level" };
    }
    risks.push({
      name: clean(entry.name, 80),
      description: typeof entry.description === "string" ? clean(entry.description) : "",
      level: clean(entry.level, 20).toLowerCase(),
      score: typeof entry.score === "number" && Number.isFinite(entry.score) ? entry.score : null,
      value: typeof entry.value === "string" ? clean(entry.value, 40) : "",
    });
  }
  return {
    ok: true,
    summary: {
      scoreNormalised: finiteOrNull(body.score_normalised, 0, 100),
      risks,
      lpLockedPct: finiteOrNull(body.lpLockedPct, 0, 100),
      tokenProgram: typeof body.tokenProgram === "string" && body.tokenProgram.trim() ? body.tokenProgram.trim() : null,
    },
  };
}

export interface RugCheckOptions {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

export async function fetchRugCheckSummary(mint: string, options: RugCheckOptions = {}): Promise<RugCheckResult> {
  const now = options.now ?? Date.now, started = now();
  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? RUGCHECK_TIMEOUT_MS);
  const unavailable = (reason: string, httpStatus: number | null): RugCheckResult =>
    ({ status: "unavailable", reason, httpStatus, latencyMs: Math.max(0, now() - started), fetchedAt: started });
  try {
    const response = await fetcher(rugCheckSummaryUrl(mint), {
      headers: { Accept: "application/json" }, signal: controller.signal, cache: "no-store",
    });
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) return unavailable("RugCheck response exceeded the size limit", response.status);
    if (response.status === 429) return unavailable("RugCheck rate limit reached (HTTP 429); not retried", 429);
    if (response.status >= 500) return unavailable(`RugCheck service error (HTTP ${response.status})`, response.status);
    let body: unknown;
    try { body = JSON.parse(text); } catch { return unavailable(`RugCheck returned a non-JSON response (HTTP ${response.status})`, response.status); }
    if (!response.ok) {
      const detail = isRecord(body) && typeof body.error === "string" ? `: ${clean(body.error)}` : "";
      return unavailable(`RugCheck has no report for this mint (HTTP ${response.status}${detail})`, response.status);
    }
    const parsed = parseRugCheckSummary(body);
    if (!parsed.ok) return unavailable(parsed.reason, response.status);
    return { status: "ok", summary: parsed.summary, httpStatus: response.status, latencyMs: Math.max(0, now() - started), fetchedAt: started };
  } catch {
    // Transport errors are not echoed: they can carry URLs and internal detail.
    return unavailable(controller.signal.aborted ? `RugCheck did not respond within ${(options.timeoutMs ?? RUGCHECK_TIMEOUT_MS) / 1000}s` : "RugCheck could not be reached", null);
  } finally {
    clearTimeout(timer);
  }
}
