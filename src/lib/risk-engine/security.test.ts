import { describe, expect, it } from "vitest";
import { RULES, buildRiskReport, EXTERNAL_SIGNAL_IDS, CATEGORY_WEIGHTS, aggregateScore } from "./engine";
import { rugSecurityRule, RUG_SECURITY_MAX_POINTS, NO_ADDITIONAL_WARNING, severityForIssues } from "./rules/security";
import { cleanRugCheck, makeInput } from "./test-fixtures";
import { fetchRugCheckSummary, parseRugCheckSummary, rugCheckSummaryUrl, type RugCheckResult } from "../providers/rugcheck";
import { MARKET_ALGORITHM_VERSION } from "../market/policy";
import live from "../providers/fixtures/rugcheck-live-2026-09-27.json";
import type { AnalysisInput } from "./input";
import { RISK_CATEGORIES, type RiskReport, type TokenOverview } from "./types";

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
const AUTHORITY = "Authority111111111111111111111111111111111";
/** Custodial-stablecoin shape (USDC): active mint and freeze authority. */
const custodial = () => makeInput({ mintInfo: { ...makeInput().mintInfo, mintAuthority: AUTHORITY, freezeAuthority: AUTHORITY } });
const unavailableRugCheck: RugCheckResult = { status: "unavailable", reason: "RugCheck rate limit reached (HTTP 429); not retried", httpStatus: 429, latencyMs: 3, fetchedAt: 0 };
/** The score the 13 on-chain signals produce on their own, recomputed independently of Signal 14 handling. */
function thirteenSignalScore(report: RiskReport): number | null {
  const onChain = report.signals.filter((s) => s.id !== "rug-security" && s.status === "ok");
  return aggregateScore(RISK_CATEGORIES.map((category) => {
    const inCategory = onChain.filter((s) => s.category === category);
    const maxPoints = inCategory.reduce((sum, s) => sum + s.maxPoints, 0), points = inCategory.reduce((sum, s) => sum + s.points, 0);
    return { category, points, maxPoints, percent: maxPoints > 0 ? Math.round((points / maxPoints) * 100) : null, signalCount: inCategory.length, weight: CATEGORY_WEIGHTS[category] };
  }));
}
const s14 = (report: RiskReport) => report.signals.find((s) => s.id === "rug-security")!;
const onChainSignals = (report: RiskReport) => report.signals.filter((s) => s.id !== "rug-security");

describe("Signal 14 — Rug / Security Risk (RugCheck)", () => {
  it("is exactly one additional external signal: 14 definitions; weight 6 only when score-eligible", () => {
    const report = buildRiskReport(makeInput(), context);
    expect(RULES).toHaveLength(14);
    expect(report.signals.filter((s) => s.id === "rug-security")).toHaveLength(1);
    expect(RUG_SECURITY_MAX_POINTS).toBe(6);
    expect(report.totalWeight).toBe(152);
    expect(buildRiskReport(makeInput({ rugCheck: liveResult("creatorHistoryAndLp") }), context).totalWeight).toBe(158);
    expect(EXTERNAL_SIGNAL_IDS.has("rug-security")).toBe(true);
    expect(MARKET_ALGORITHM_VERSION).toBe("market-integrity-v2.8");
  });

  it("clean report (live SOL/USDC shape): visible, context only, weight 0, provider score shown as context only", () => {
    for (const name of ["SOL", "USDC"] as const) {
      const signal = rule(liveResult(name));
      expect(signal).toMatchObject({ status: "ok", severity: "none", points: 0, maxPoints: 0, observedValue: NO_ADDITIONAL_WARNING });
      expect(signal.evidence).toContainEqual(expect.objectContaining({ label: "Score participation", value: expect.stringContaining("Context only") }));
      expect(signal.evidence).toContainEqual(expect.objectContaining({ label: "Source", value: expect.stringContaining("RugCheck") }));
      expect(signal.evidence).toContainEqual({ label: "RugCheck normalised score", value: "1/100 — provider context only, not used in scoring" });
    }
  });

  it("moderate findings: two distinct RugCheck-specific warnings → medium", () => {
    const signal = rule(ok([{ name: "Missing file metadata", level: "warn" }, { name: "High market cap per holder", level: "warn" }]));
    expect(signal).toMatchObject({ severity: "medium", points: 3, maxPoints: 6 });
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
    expect(signal).toMatchObject({ severity: "none", points: 0, maxPoints: 0, observedValue: NO_ADDITIONAL_WARNING });
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
    expect(signal).toMatchObject({ severity: "none", points: 0, maxPoints: 0, observedValue: NO_ADDITIONAL_WARNING });
    expect(signal.evidence).toContainEqual(expect.objectContaining({ label: "Corroborates Metadata Mutability" }));
  });

  it("schema drift: unknown risk names are capped at warning level, unknown levels are shown but not scored, nothing crashes", () => {
    const drift = rule(ok([{ name: "Brand new risk type", level: "danger" }, { name: "Another new thing", level: "critical-ish" }]));
    expect(drift).toMatchObject({ status: "ok", severity: "low", maxPoints: 6 });
    // An unrecognized level alone is shown but never scored.
    expect(rule(ok([{ name: "Another new thing", level: "critical-ish" }]))).toMatchObject({ status: "ok", severity: "none", maxPoints: 0 });
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
    expect(s14(report)).toMatchObject({ status: "unavailable", maxPoints: 0, points: 0 });
    expect(report.totalWeight).toBe(152);
    expect(report.availableWeight).toBe(152);
    expect(report.coveragePercent).toBe(100);
    expect(report.score).toBe(thirteenSignalScore(report));
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
    const report = buildRiskReport({ ...thin, rugCheck: liveResult("creatorHistoryAndLp") }, context);
    expect(s14(report)).toMatchObject({ status: "ok", maxPoints: 6 });
    expect(report.coveragePercent).toBeGreaterThanOrEqual(40);
    expect(report.score).toBeNull();
    expect(report.classification).toBe("Insufficient Data");
  });
});

describe("Signal 14 may only add risk (pre-merge scoring fix)", () => {
  it("1. USDC-style clean RugCheck report: visible, weight not in the denominator, 13-signal score unchanged", () => {
    const report = buildRiskReport({ ...custodial(), rugCheck: liveResult("USDC") }, context);
    expect(s14(report)).toMatchObject({ status: "ok", observedValue: NO_ADDITIONAL_WARNING, maxPoints: 0, points: 0 });
    expect(report.totalWeight).toBe(152);
    expect(report.categories.find((c) => c.category === "Authorities")).toMatchObject({ maxPoints: 58, points: 31.2 });
    expect(report.score).toBe(thirteenSignalScore(report));
    const missing = buildRiskReport({ ...custodial(), rugCheck: unavailableRugCheck }, context);
    expect(report.score).toBe(missing.score);
    expect(report.coveragePercent).toBe(missing.coveragePercent);
  });

  it("2. overlap-only RugCheck report: corroboration shown, no penalty, 13-signal score unchanged", () => {
    const input = makeInput({ mintInfo: { ...program2022(makeInput()), mintAuthority: AUTHORITY } });
    const report = buildRiskReport({ ...input, rugCheck: liveResult("permanentControl") }, context);
    expect(s14(report)).toMatchObject({ maxPoints: 0, points: 0, severity: "none" });
    expect(s14(report).evidence.filter((e) => e.label.startsWith("Corroborates"))).toHaveLength(4);
    expect(report.totalWeight).toBe(152);
    expect(report.score).toBe(thirteenSignalScore(report));
  });

  it("3. genuine new RugCheck security finding: score-eligible, weight 6 participates, risk increases", () => {
    const report = buildRiskReport(makeInput({ rugCheck: liveResult("creatorHistoryAndLp") }), context);
    expect(s14(report)).toMatchObject({ status: "ok", severity: "critical", maxPoints: 6, points: 6 });
    expect(report.totalWeight).toBe(158);
    expect(report.availableWeight).toBe(158);
    expect(report.categories.find((c) => c.category === "Authorities")).toMatchObject({ maxPoints: 64, points: 6 });
    expect(report.score!).toBeGreaterThan(thirteenSignalScore(report)!);
    expect(report.score! - thirteenSignalScore(report)!).toBeLessThanOrEqual(4);
    expect(report.summary.topConcerns.map((c) => c.id)).toContain("rug-security");
  });

  it("3b. an eligible finding that would lower an already-risky category is shown but not scored; a stronger one still raises risk", () => {
    const low = buildRiskReport({ ...custodial(), rugCheck: ok([{ name: "Missing file metadata", level: "warn" }]) }, context);
    expect(s14(low)).toMatchObject({ severity: "low", maxPoints: 0, points: 0 });
    expect(s14(low).evidence.find((e) => e.label === "Score participation")?.value).toContain("would lower the Authorities category");
    expect(low.score).toBe(thirteenSignalScore(low));
    const critical = buildRiskReport({ ...custodial(), rugCheck: ok([{ name: "Creator history of rugged tokens", level: "danger" }, { name: "Large Amount of LP Unlocked", level: "danger" }]) }, context);
    expect(s14(critical)).toMatchObject({ severity: "critical", maxPoints: 6, points: 6 });
    expect(critical.score!).toBeGreaterThanOrEqual(thirteenSignalScore(critical)!);
    expect(critical.categories.find((c) => c.category === "Authorities")!.percent!)
      .toBeGreaterThanOrEqual(low.categories.find((c) => c.category === "Authorities")!.percent!);
  });

  it("4. missing RugCheck: unavailable, 152 denominator, 13-signal score unchanged", () => {
    const report = buildRiskReport({ ...custodial(), rugCheck: unavailableRugCheck }, context);
    expect(s14(report)).toMatchObject({ status: "unavailable", maxPoints: 0, points: 0 });
    expect(report.totalWeight).toBe(152);
    expect(report.score).toBe(thirteenSignalScore(report));
  });

  it("5. unknown RugCheck finding: no crash, capped at warning level, never lowers risk", () => {
    const clean = buildRiskReport(makeInput({ rugCheck: ok([{ name: "Brand new risk type", level: "danger" }]) }), context);
    expect(s14(clean)).toMatchObject({ severity: "low", maxPoints: 6, points: 1.5 });
    expect(clean.score!).toBeGreaterThanOrEqual(thirteenSignalScore(clean)!);
    const risky = buildRiskReport({ ...custodial(), rugCheck: ok([{ name: "Brand new risk type", level: "danger" }]) }, context);
    expect(risky.score).toBe(thirteenSignalScore(risky));
  });

  it("6. the 13 existing signals are unchanged: weights, thresholds and behaviour do not depend on RugCheck", () => {
    const input = custodial(), base = buildRiskReport(input, context);
    expect(onChainSignals(base).map((s) => [s.id, s.maxPoints])).toEqual([
      ["mint-authority", 20], ["freeze-authority", 14], ["token-extensions", 18], ["metadata-mutability", 6],
      ["top-holder", 18], ["holder-spread", 10], ["liquidity-depth", 16], ["liquidity-ratio", 10], ["pool-diversity", 6],
      ["trading-activity", 10], ["trade-imbalance", 6], ["price-volatility", 6], ["pool-maturity", 12],
    ]);
    expect(onChainSignals(base).reduce((sum, s) => sum + s.maxPoints, 0)).toBe(152);
    for (const rugCheck of [liveResult("USDC"), liveResult("JUP"), liveResult("creatorHistoryAndLp"), unavailableRugCheck]) {
      const report = buildRiskReport({ ...input, rugCheck }, context);
      expect(onChainSignals(report)).toEqual(onChainSignals(base));
      expect(report.score!).toBeGreaterThanOrEqual(thirteenSignalScore(report)!);
    }
  });
});
