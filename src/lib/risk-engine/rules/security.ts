import type { AnalysisInput } from "../input";
import type { Evidence, RiskSignal, Severity } from "../types";
import { signal, unavailable, plural } from "../helpers";
import { RUGCHECK_SOURCE, type RugCheckRisk } from "../../providers/rugcheck";

/**
 * Signal 14 — Rug / Security Risk: an external second opinion from RugCheck.
 *
 * RugCheck's headline score is never copied. Its structured findings are
 * mapped deterministically, and only findings that add information beyond the
 * 13 on-chain signals are scored. A finding that repeats something another
 * signal already measures is shown as corroboration and charged nowhere here,
 * so one condition is never penalised twice.
 */

const ID = "rug-security";
const LABEL = "Rug / Security Risk";
const CATEGORY = "Authorities" as const;
const METRIC = "External security cross-check by RugCheck";
/**
 * Equal to the smallest existing rule weight (metadata mutability, pool
 * diversity, trade imbalance, volatility). An external opinion we cannot
 * verify must never outweigh an on-chain rule it could corroborate. In the
 * Authorities category (58) it can move that category by at most 6/64 = 9.4
 * points, and the overall score of an otherwise clean token by at most 4.
 *
 * The weight participates only when RugCheck reports new, RugCheck-specific
 * security information. A clean, overlap-only or unavailable result carries
 * weight 0: it is shown as context but can neither enter the denominator nor
 * lower the 13-signal score.
 */
export const RUG_SECURITY_MAX_POINTS = 6;
export const NO_ADDITIONAL_WARNING = "No additional RugCheck-specific warning detected";

/** RugCheck findings that repeat an existing signal: corroboration only. */
export const OVERLAPPING_FINDINGS: Record<string, { signalId: string; signalLabel: string }> = {
  "mint authority still enabled": { signalId: "mint-authority", signalLabel: "Mint Authority" },
  "freeze authority still enabled": { signalId: "freeze-authority", signalLabel: "Freeze Authority" },
  "mutable metadata": { signalId: "metadata-mutability", signalLabel: "Metadata Mutability" },
  "permanent control enabled": { signalId: "token-extensions", signalLabel: "Token-2022 Extensions (permanent delegate)" },
  "fee config enabled": { signalId: "token-extensions", signalLabel: "Token-2022 Extensions (transfer fee)" },
  "single holder ownership": { signalId: "top-holder", signalLabel: "Largest Holder" },
  "high ownership": { signalId: "holder-spread", signalLabel: "Largest Holder / Holder Spread" },
  "top 10 holders high ownership": { signalId: "holder-spread", signalLabel: "Holder Spread" },
  "high holder concentration": { signalId: "holder-spread", signalLabel: "Holder Spread" },
  "low liquidity": { signalId: "liquidity-depth", signalLabel: "Liquidity Depth" },
};

/**
 * RugCheck-specific findings, grouped by underlying issue so several findings
 * describing one condition count once. LP custody is displayed elsewhere in the
 * report but never scored, so LP findings are new information to the score.
 */
export const SPECIFIC_FINDINGS: Record<string, { issue: string; title: string }> = {
  "creator history of rugged tokens": { issue: "creator-history", title: "Creator history of rugged tokens" },
  "large amount of lp unlocked": { issue: "lp-control", title: "Withdrawable LP / few LP providers" },
  "low amount of lp providers": { issue: "lp-control", title: "Withdrawable LP / few LP providers" },
  "missing file metadata": { issue: "metadata-integrity", title: "Missing metadata file" },
  "high market cap per holder": { issue: "holder-base", title: "Market cap high relative to holder count" },
};

type Level = "danger" | "warn";
const RANK: Record<Level, number> = { warn: 1, danger: 2 };
const knownLevel = (level: string): Level | null => (level === "danger" || level === "warn" ? level : null);

/**
 * Severity from distinct RugCheck-specific issues:
 *   2+ danger → critical · 1 danger → high · 2+ warn → medium · 1 warn → low · none → none.
 * Unrecognized finding names cannot be ruled out as duplicates, so they count
 * at most as warn. Unrecognized levels are shown but never scored.
 */
export function severityForIssues(levels: Level[]): Severity {
  const danger = levels.filter((l) => l === "danger").length, warn = levels.length - danger;
  if (danger >= 2) return "critical";
  if (danger === 1) return "high";
  if (warn >= 2) return "medium";
  if (warn === 1) return "low";
  return "none";
}

const describe = (risk: RugCheckRisk) => `${risk.name} (${risk.level || "no level"})${risk.value ? ` — ${risk.value}` : ""}`;

/**
 * Report-level step: state what each corroborated signal actually found. When
 * that signal could not be measured, the RugCheck finding is shown for
 * reference but scored nowhere — it is never substituted for an on-chain
 * measurement, and it never lands in another category's score.
 */
export function annotateCorroboration(signals: RiskSignal[]): RiskSignal[] {
  const byLabel = new Map(Object.values(OVERLAPPING_FINDINGS).map((o) => [o.signalLabel, o.signalId]));
  return signals.map((s) => s.id !== ID ? s : {
    ...s,
    evidence: s.evidence.map((e) => {
      if (!e.label.startsWith("Corroborates ")) return e;
      const own = signals.find((o) => o.id === byLabel.get(e.label.slice("Corroborates ".length)));
      const note = !own ? "" : own.status === "ok"
        ? `; measured on-chain by ${own.label} (${own.severity}), which carries the score`
        : `; ${own.label} could not be measured on-chain, so this condition is shown for reference only and is not scored anywhere in this report`;
      return { ...e, value: `${e.value}${note}` };
    }),
  });
}

/**
 * Report-level step: an eligible RugCheck issue may only add risk. Its category
 * is a weighted mean, so charging it at a severity below the category's
 * existing on-chain ratio would *lower* that category. In that case the signal
 * stays visible with its severity but carries weight 0 for this report.
 */
export function enforceNonDecreasing(signals: RiskSignal[]): RiskSignal[] {
  return signals.map((s) => {
    if (s.id !== ID || s.status !== "ok" || s.maxPoints === 0) return s;
    const others = signals.filter((o) => o !== s && o.category === s.category && o.status === "ok");
    const points = others.reduce((sum, o) => sum + o.points, 0), maxPoints = others.reduce((sum, o) => sum + o.maxPoints, 0);
    if (maxPoints === 0 || s.points / s.maxPoints >= points / maxPoints) return s;
    return {
      ...s, maxPoints: 0, points: 0,
      explanation: `${s.explanation} In this report the existing on-chain ${s.category} findings already carry a higher share of risk than this finding would, so charging it would lower the category; it is shown but not scored.`,
      evidence: s.evidence.map((e) => e.label !== "Score participation" ? e : {
        ...e, value: `Context only for this report: charging this ${s.severity} finding would lower the ${s.category} category (existing on-chain findings already exceed its share), so weight 0 — the 13-signal score is unchanged`,
      }),
    };
  });
}

export function rugSecurityRule({ mint, mintInfo, rugCheck }: AnalysisInput): RiskSignal {
  const base = { id: ID, label: LABEL, category: CATEGORY, metric: METRIC, maxPoints: 0 };
  const source: Evidence = { label: "Source", value: `${RUGCHECK_SOURCE} report summary (external)`, href: `https://rugcheck.xyz/tokens/${mint}` };

  if (rugCheck.status === "unavailable") {
    return unavailable({
      ...base,
      reason: `Not measured: ${rugCheck.reason}. Signal 14 does not participate in scoring; its weight is excluded from the denominator, and missing external data is never treated as low risk.`,
      evidence: [source, ...(rugCheck.httpStatus !== null ? [{ label: "HTTP status", value: String(rugCheck.httpStatus) }] : [])],
    });
  }
  const { summary } = rugCheck;
  // The report must describe this mint's program, or it may describe something else.
  if (summary.tokenProgram && summary.tokenProgram !== mintInfo.programId) {
    return unavailable({
      ...base,
      reason: `Not measured: RugCheck reports token program ${summary.tokenProgram}, but the mint is owned by ${mintInfo.programId}. Signal 14 does not participate in scoring; its weight is excluded from the denominator.`,
      evidence: [source],
    });
  }

  const issues = new Map<string, { title: string; level: Level; findings: RugCheckRisk[] }>();
  const corroborating: { risk: RugCheckRisk; label: string }[] = [];
  const unrecognized: RugCheckRisk[] = [];
  const unscoredLevel: RugCheckRisk[] = [];
  for (const risk of summary.risks) {
    const key = risk.name.trim().toLowerCase(), level = knownLevel(risk.level);
    const overlap = OVERLAPPING_FINDINGS[key];
    if (overlap) { corroborating.push({ risk, label: overlap.signalLabel }); continue; }
    if (!level) { unscoredLevel.push(risk); continue; }
    const specific = SPECIFIC_FINDINGS[key];
    if (!specific) unrecognized.push(risk);
    const issueKey = specific ? specific.issue : `unrecognized:${key}`;
    const effective: Level = specific ? level : "warn";
    const existing = issues.get(issueKey);
    if (existing) {
      existing.findings.push(risk);
      if (RANK[effective] > RANK[existing.level]) existing.level = effective;
    } else issues.set(issueKey, { title: specific?.title ?? risk.name, level: effective, findings: [risk] });
  }

  const scored = [...issues.values()].sort((a, b) => RANK[b.level] - RANK[a.level] || a.title.localeCompare(b.title));
  const severity = severityForIssues(scored.map((i) => i.level));
  const serious = scored.filter((i) => i.level === "danger").length;
  const eligible = severity !== "none";

  const evidence: Evidence[] = [
    source,
    ...scored.flatMap((issue) => issue.findings.map((risk) => ({
      label: `Scored: ${issue.title}`,
      value: `${describe(risk)}${risk.description ? `. ${risk.description}` : ""}`,
    }))),
    ...corroborating.map(({ risk, label }) => ({
      label: `Corroborates ${label}`,
      // Completed with that signal's actual result by `annotateCorroboration`.
      value: `${describe(risk)} — not charged again here`,
    })),
    ...unrecognized.map((risk) => ({
      label: "Unrecognized RugCheck finding",
      value: `${describe(risk)} — may overlap an existing signal, so counted as warning-level at most`,
    })),
    ...unscoredLevel.map((risk) => ({
      label: "Finding with unrecognized level",
      value: `${describe(risk)} — shown, not scored`,
    })),
    {
      label: "RugCheck normalised score",
      value: summary.scoreNormalised === null ? "Not reported" : `${summary.scoreNormalised}/100 — provider context only, not used in scoring`,
    },
    ...(summary.lpLockedPct !== null
      ? [{ label: "LP locked (RugCheck-reported)", value: `${summary.lpLockedPct.toFixed(2)}% — context only; on-chain LP custody is reported separately` }]
      : []),
    {
      label: "Score participation",
      value: eligible
        ? `Weight ${RUG_SECURITY_MAX_POINTS} participates: RugCheck reported security information the 13 on-chain signals do not measure`
        : "Context only: no RugCheck-specific issue, so weight 0 — not in the denominator, and the 13-signal score is unchanged",
    },
  ];

  const observedValue = !eligible
    ? NO_ADDITIONAL_WARNING
    : `${serious ? plural(serious, "serious issue") : plural(scored.length, "warning-level issue")}: ${scored.map((i) => i.title).join("; ")}`;

  const explanation = !eligible
    ? `RugCheck, an external security scanner, reported no finding beyond what the on-chain signals already measure${corroborating.length ? `; ${plural(corroborating.length, "finding")} it did report ${corroborating.length === 1 ? "repeats" : "repeat"} existing signals and ${corroborating.length === 1 ? "is" : "are"} shown as corroboration only` : ""}. This signal is therefore context only: it carries no weight and cannot change the score. An empty or clean RugCheck report is not proof that the token is safe.`
    : `RugCheck, an external security scanner, reported ${plural(scored.length, "issue")} that the on-chain signals do not measure. Its findings are a second opinion from a third party: they flag risk to review and do not prove a rug or scam. Only RugCheck-specific issues are scored here, related findings count once, and findings that repeat existing signals are shown as corroboration without a second penalty.`;

  return signal({ ...base, maxPoints: eligible ? RUG_SECURITY_MAX_POINTS : 0, severity, observedValue, explanation, evidence });
}
