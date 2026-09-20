import type { Evidence, RiskCategory, RiskSignal, Severity } from "./types";

/**
 * Shared machinery for rules, so every rule maps an observed value to points
 * the same way and the methodology stays auditable.
 *
 * A rule never invents a point value. It picks a severity from a documented
 * threshold table; the severity determines the fraction of the rule's weight
 * that is charged. This keeps the scoring uniform across rules and means a
 * rule's weight can be retuned in one place without rewriting its thresholds.
 */
export const SEVERITY_POINT_FRACTION: Record<Severity, number> = {
  none: 0,
  low: 0.25,
  medium: 0.5,
  high: 0.8,
  critical: 1,
};

export function pointsFor(severity: Severity, maxPoints: number): number {
  return Math.round(SEVERITY_POINT_FRACTION[severity] * maxPoints * 10) / 10;
}

/**
 * A threshold band: every value strictly below `below` gets `severity`.
 * Bands are evaluated in order, so they must be listed ascending and the final
 * band must use `Infinity`.
 */
export type Band = readonly [below: number, severity: Severity];

/** Pick the severity whose band the value falls into. */
export function classify(value: number, bands: readonly Band[]): Severity {
  for (const [below, severity] of bands) {
    if (value < below) return severity;
  }
  return bands[bands.length - 1][1];
}

/** Inverted bands, for metrics where a *higher* value is safer. */
export function classifyDescending(value: number, bands: readonly Band[]): Severity {
  for (const [above, severity] of bands) {
    if (value > above) return severity;
  }
  return bands[bands.length - 1][1];
}

interface SignalSpec {
  id: string;
  label: string;
  category: RiskCategory;
  metric: string;
  maxPoints: number;
  severity: Severity;
  observedValue: string;
  explanation: string;
  evidence?: Evidence[];
}

export function signal(spec: SignalSpec): RiskSignal {
  return {
    id: spec.id,
    label: spec.label,
    category: spec.category,
    metric: spec.metric,
    status: "ok",
    observedValue: spec.observedValue,
    severity: spec.severity,
    maxPoints: spec.maxPoints,
    points: pointsFor(spec.severity, spec.maxPoints),
    explanation: spec.explanation,
    evidence: spec.evidence ?? [],
  };
}

interface UnavailableSpec {
  id: string;
  label: string;
  category: RiskCategory;
  metric: string;
  maxPoints: number;
  reason: string;
  evidence?: Evidence[];
}

/**
 * A signal that could not be computed. It scores zero points *and* is excluded
 * from the score denominator, so missing data neither inflates nor deflates the
 * result — it only reduces coverage.
 */
export function unavailable(spec: UnavailableSpec): RiskSignal {
  return {
    id: spec.id,
    label: spec.label,
    category: spec.category,
    metric: spec.metric,
    status: "unavailable",
    observedValue: "Not available",
    severity: "none",
    maxPoints: spec.maxPoints,
    points: 0,
    explanation: spec.reason,
    evidence: spec.evidence ?? [],
  };
}

// ---------------------------------------------------------------------------
// Formatting used inside rule explanations and evidence.
// ---------------------------------------------------------------------------

export function pct(fraction: number, digits = 2): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function usd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

export function duration(days: number): string {
  if (days < 1 / 24) return `${Math.max(1, Math.round(days * 24 * 60))} minutes`;
  if (days < 1) return `${(days * 24).toFixed(1)} hours`;
  if (days < 60) return `${days.toFixed(1)} days`;
  if (days < 730) return `${(days / 30.44).toFixed(1)} months`;
  return `${(days / 365.25).toFixed(1)} years`;
}

export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}
