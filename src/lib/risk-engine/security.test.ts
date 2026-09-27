import { describe, expect, it } from "vitest";
import { RULES, buildRiskReport, EXTERNAL_SIGNAL_IDS } from "./engine";
import { rugSecurityRule, RUG_SECURITY_MAX_POINTS, severityForIssues } from "./rules/security";
import { cleanRugCheck, makeInput } from "./test-fixtures";
import { fetchRugCheckSummary, parseRugCheckSummary, rugCheckSummaryUrl, type RugCheckResult } from "../providers/rugcheck";
import { MARKET_ALGORITHM_VERSION } from "../market/policy";
import live from "../providers/fixtures/rugcheck-live-2026-09-27.json";
import type { AnalysisInput } from "./input";
import type { TokenOverview } from "./types";

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const context = { overview: {} as TokenOverview, sources: [], elapsedMs: 0 };
type Risk = { name: string; level: string; description?: string; score?: number; value?: string };
const ok = (risks: Risk[], extra: Record<string, unknown> = {}): RugCheckResult => {
  const parsed = parseRugCheckSummary({ tokenProgram: TOKEN, tokenType: "", risks, score: 1, score_normalised: 10, lpLockedPct: 0, ...extra });
  if (!parsed.ok) throw new Error(parsed.reason);
  return { status: "ok", summary: parsed.summary, httpStatus: 200, latencyMs: 80, fetchedAt: 0 };
};
const rule = (rugCheck: RugCheckResult, overrides: Partial<AnalysisInput> = {}) => rugSecurityRule(makeInput({ ...overrides, rugCheck }));
const liveResult = (name: keyof typeof live): RugCheckResult => {
  const parsed = parseRugCheckSummary((live[name] as { body: unknown }).body);
  if (!parsed.ok) throw new Error(parsed.reason);
  return { status: "ok", summary: parsed.summary, httpStatus: 200, latencyMs: 80, fetchedAt: 0 };
};
const program2022 = (input: AnalysisInput) => ({ ...input.mintInfo, tokenProgram: "spl-token-2022" as const, programId: TOKEN_2022 });
const response = (status: number, body: unknown) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

describe("Signal 14 — Rug / Security Risk (RugCheck)", () => {
  it("is exactly one additional external signal: 14 signals, total weight 152 + 6", () => {
    const report = buildRiskReport(makeInput(), context);
    expect(RULES).toHaveLength(14);
    expect(report.signals.filter((s) => s.id === "rug-security")).toHaveLength(1);
    expect(RUG_SECURITY_MAX_POINTS).toBe(6);
    expect(report.totalWeight).toBe(158);
    expect(EXTERNAL_SIGNAL_IDS.has("rug-security")).toBe(true);
    expect(MARKET_ALGORITHM_VERSION).toBe("market-integrity-v2.5");
  });

  it("clean report (live SOL/USDC shape): measured, severity none, provider score shown as context only", () => {
    for (const name of ["SOL", "USDC"] as const) {
      const signal = rule(liveResult(name));
      expect(signal).toMatchObject({ status: "ok", severity: "none", points: 0, maxPoints: 6, observedValue: "No findings reported" });
      expect(signal.evidence).toContainEqual(expect.objectContaining({ label: "Source", value: expect.stringContaining("RugCheck") }));
      expect(signal.evidence).toContainEqual({ label: "RugCheck normalised score", value: "1/100 — provider context only, not used in scoring" });
    }
  });

  it("moderate findings: two distinct RugCheck-specific warnings → medium", () => {
    const signal = rule(ok([{ name: "Missing file metadata", level: "warn" }, { name: "High market cap per holder", level: "warn" }]));
    expect(signal).toMatchObject({ severity: "medium", points: 3 });
    expect(signal.observedValue).toBe("2 warning-level issues: Market cap high relative to holder count; Missing metadata file");
  });

  it("serious findings: one danger issue → high; two independent danger issues → critical (live shape)", () => {
    expect(rule(liveResult("creatorHistoryOnly"), { mintInfo: program2022(makeInput()) })).toMatchObject({ severity: "high", points: 4.8 });
    const both = rule(liveResult("creatorHistoryAndLp"));
    expect(both).toMatchObject({ severity: "critical", points: 6 });
    expect(both.observedValue).toBe("2 serious issues: Creator history of rugged tokens; Withdrawable LP / few LP providers");
  });

  it("multiple findings describing one underlying issue count once", () => {
    const lp = rule(ok([{ name: "Large Amount of LP Unlocked", level: "danger", value: "100.00%" }, { name: "Low amount of LP Providers", level: "warn" }]));
    expect(lp.severity).toBe("high");
    expect(lp.evidence.filter((e) => e.label === "Scored: Withdrawable LP / few LP providers")).toHaveLength(2);
    const holders = rule(liveResult("holderConcentration"), { mintInfo: program2022(makeInput()) });
    expect(holders).toMatchObject({ severity: "none", points: 0 });
    expect(holders.evidence.filter((e) => e.label.startsWith("Corroborates"))).toHaveLength(2);
  });

  it("findings that repeat an existing signal corroborate it and are never charged twice (live permanent-control shape)", () => {
    const input = makeInput({ mintInfo: { ...program2022(makeInput()), mintAuthority: "Authority111111111111111111111111111111111" } });
    const signal = rugSecurityRule({ ...input, rugCheck: liveResult("permanentControl") });
    expect(signal).toMatchObject({ severity: "none", points: 0, observedValue: "No additional findings (4 corroborating findings)" });
    for (const label of ["Mint Authority", "Token-2022 Extensions (permanent delegate)", "Liquidity Depth", "Metadata Mutability"]) {
      expect(signal.evidence.some((e) => e.label === `Corroborates ${label}` && e.value.includes("not charged again"))).toBe(true);
    }
    const annotated = buildRiskReport({ ...input, rugCheck: liveResult("permanentControl") }, context).signals.find((s) => s.id === "rug-security")!;
    expect(annotated.evidence.find((e) => e.label === "Corroborates Mint Authority")?.value).toContain("measured on-chain by Mint Authority (critical), which carries the score");
    // The whole report's points are identical with or without the overlapping findings.
    const withFindings = buildRiskReport({ ...input, rugCheck: liveResult("permanentControl") }, context);
    const clean = buildRiskReport({ ...input, rugCheck: { ...cleanRugCheck(), summary: { ...cleanRugCheck().summary, tokenProgram: TOKEN_2022 } } }, context);
    expect(withFindings.score).toBe(clean.score);
    expect(withFindings.signals.find((s) => s.id === "mint-authority")?.severity).toBe("critical");
  });

  it("an overlapping finding for an on-chain signal that could not be measured is shown, never substituted or scored", () => {
    const input = makeInput({ marketData: { available: false, pairs: [], name: null, symbol: null, imageUrl: null, websites: [], socials: [] } });
    const report = buildRiskReport({ ...input, rugCheck: ok([{ name: "Low Liquidity", level: "danger", value: "$2.41" }]) }, context);
    const s14 = report.signals.find((s) => s.id === "rug-security")!;
    expect(report.signals.find((s) => s.id === "liquidity-depth")?.status).toBe("unavailable");
    expect(s14).toMatchObject({ severity: "none", points: 0 });
    expect(s14.evidence.find((e) => e.label === "Corroborates Liquidity Depth")?.value).toContain("could not be measured on-chain, so this condition is shown for reference only and is not scored anywhere");
  });

  it("overlap with an existing Risk Radar signal (live JUP 'Mutable metadata') adds no points", () => {
    const signal = rule(liveResult("JUP"));
    expect(signal).toMatchObject({ severity: "none", points: 0, observedValue: "No additional findings (1 corroborating finding)" });
  });

  it("schema drift: unknown risk names are capped at warning level, unknown levels are shown but not scored, nothing crashes", () => {
    const drift = rule(ok([{ name: "Brand new risk type", level: "danger" }, { name: "Another new thing", level: "critical-ish" }]));
    expect(drift).toMatchObject({ status: "ok", severity: "low" });
    expect(drift.evidence).toContainEqual(expect.objectContaining({ label: "Unrecognized RugCheck finding" }));
    expect(drift.evidence).toContainEqual(expect.objectContaining({ label: "Finding with unrecognized level" }));
    expect(parseRugCheckSummary({ risks: [], extraField: { nested: true } }).ok).toBe(true);
  });

  it("severity mapping is deterministic", () => {
    expect(severityForIssues([])).toBe("none");
    expect(severityForIssues(["warn"])).toBe("low");
    expect(severityForIssues(["warn", "warn"])).toBe("medium");
    expect(severityForIssues(["danger", "warn"])).toBe("high");
    expect(severityForIssues(["danger", "danger"])).toBe("critical");
  });

  it("a report for a different token program is not trusted", () => {
    const signal = rule(liveResult("creatorHistoryOnly"));
    expect(signal.status).toBe("unavailable");
    expect(signal.explanation).toContain("but the mint is owned by");
  });

  it("never claims a scam or a safe token", () => {
    for (const result of [liveResult("SOL"), liveResult("creatorHistoryAndLp")]) {
      const text = JSON.stringify(rule(result));
      expect(text).not.toMatch(/scam detected|safe token|is a scam|rug detected|confirmed rug/i);
      // "safe" appears only inside the explicit disclaimer.
      expect(text.replace("not proof that the token is safe", "")).not.toMatch(/safe/i);
    }
  });
});

describe("Signal 14 — missing data is unavailable, never low risk", () => {
  const cases: [string, typeof fetch, RegExp][] = [
    ["missing report (400)", response(400, { error: "unable to generate report" }), /no report for this mint \(HTTP 400: unable to generate report\)/],
    ["not found (404)", response(404, { error: "not found" }), /HTTP 404/],
    ["rate limited (429)", response(429, "Too Many Requests"), /HTTP 429/],
    ["server error (503)", response(503, "<html>"), /HTTP 503/],
    ["non-JSON body", response(200, "<html>oops</html>"), /non-JSON/],
    ["risks missing", response(200, { score: 1 }), /no risks list/],
    ["risks not a list", response(200, { risks: "none" }), /no risks list/],
    ["finding without a name", response(200, { risks: [{ level: "danger" }] }), /readable name or level/],
    ["error field on 200", response(200, { error: "invalid token mint", risks: [] }), /could not assess this mint: invalid token mint/],
    ["array body", response(200, []), /malformed/],
    ["transport failure", async () => { throw new Error("connect ECONNREFUSED https://secret"); }, /could not be reached/],
  ];
  it.each(cases)("%s", async (_name, fetcher, reason) => {
    const result = await fetchRugCheckSummary("So11111111111111111111111111111111111111112", { fetcher });
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") expect(result.reason).toMatch(reason);
    expect(JSON.stringify(result)).not.toContain("secret");
    const signal = rule(result);
    expect(signal).toMatchObject({ status: "unavailable", points: 0, severity: "none" });
    expect(signal.explanation).toContain("never treated as low risk");
  });

  it("timeout aborts and is unavailable", async () => {
    const fetcher: typeof fetch = (_url, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    const result = await fetchRugCheckSummary("So11111111111111111111111111111111111111112", { fetcher, timeoutMs: 20 });
    expect(result).toMatchObject({ status: "unavailable", reason: "RugCheck did not respond within 0.02s", httpStatus: null });
  });

  it("calls only the documented summary endpoint, once, without retrying", async () => {
    const urls: string[] = [];
    const fetcher: typeof fetch = async (url) => { urls.push(String(url)); return new Response("", { status: 429 }); };
    await fetchRugCheckSummary("JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", { fetcher });
    expect(urls).toEqual(["https://api.rugcheck.xyz/v1/tokens/JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN/report/summary"]);
    expect(rugCheckSummaryUrl("x/y")).toContain("x%2Fy");
  });

  it("unavailable is excluded from the denominator and leaves the 13 on-chain results untouched", () => {
    const unavailableResult: RugCheckResult = { status: "unavailable", reason: "RugCheck rate limit reached (HTTP 429); not retried", httpStatus: 429, latencyMs: 5, fetchedAt: 0 };
    const input = makeInput({ mintInfo: { ...makeInput().mintInfo, mintAuthority: "Authority111111111111111111111111111111111" } });
    const report = buildRiskReport({ ...input, rugCheck: unavailableResult }, context);
    expect(report.totalWeight).toBe(158);
    expect(report.availableWeight).toBe(152);
    expect(report.coveragePercent).toBe(Math.round(152 / 158 * 100));
    const authorities = report.categories.find((c) => c.category === "Authorities")!;
    expect(authorities.maxPoints).toBe(58);
    expect(report.warnings.join(" ")).toContain("Rug / Security Risk");
  });

  it("an external signal can never make a too-thin on-chain report publishable", () => {
    const input = makeInput();
    const thin = makeInput({
      holderData: { ...input.holderData, available: false, holders: [], topHolderShare: null, top10Share: null, next9Share: null, error: "unavailable" },
      marketData: { available: false, pairs: [], name: null, symbol: null, imageUrl: null, websites: [], socials: [] },
    });
    const report = buildRiskReport(thin, context);
    expect(report.signals.find((s) => s.id === "rug-security")?.status).toBe("ok");
    expect(report.coveragePercent).toBeGreaterThanOrEqual(40);
    expect(report.score).toBeNull();
    expect(report.classification).toBe("Insufficient Data");
  });
});

describe("Signal 14 cannot dominate the on-chain engine", () => {
  it("worst-case RugCheck result moves an otherwise clean token by at most 4 points and cannot leave the Low band", () => {
    const clean = buildRiskReport(makeInput(), context);
    const worst = buildRiskReport(makeInput({ rugCheck: liveResult("creatorHistoryAndLp") }), context);
    expect(worst.signals.find((s) => s.id === "rug-security")?.severity).toBe("critical");
    expect(worst.score! - clean.score!).toBeLessThanOrEqual(4);
    expect(worst.classification).toBe(clean.classification);
    // The finding is still surfaced as a concern even though its score weight is small.
    expect(worst.summary.topConcerns.map((c) => c.id)).toContain("rug-security");
  });

  it("a clean external report dilutes Authorities by at most 58/64", () => {
    const input = makeInput({ mintInfo: { ...makeInput().mintInfo, mintAuthority: "Authority111111111111111111111111111111111" } });
    const measured = buildRiskReport(input, context).categories.find((c) => c.category === "Authorities")!;
    const excluded = buildRiskReport({ ...input, rugCheck: { status: "unavailable", reason: "x", httpStatus: null, latencyMs: null, fetchedAt: 0 } }, context)
      .categories.find((c) => c.category === "Authorities")!;
    expect(measured.percent! / excluded.percent!).toBeGreaterThanOrEqual(58 / 64 - 0.01);
  });
});
