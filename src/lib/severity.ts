import type { RiskClassification, Severity } from "./risk-engine/types";

/**
 * Severity is a *status* scale, not a categorical one, so it follows the status
 * palette rules: reserved colours, and never colour alone.
 *
 * These five steps were validated for contrast against the dark surface.
 * Adjacent pairs in the yellow-to-orange region cannot reach the ΔE ≥ 15
 * separation floor — that is intrinsic to any ordered green-to-red ramp, and
 * holds even for a purpose-built status palette. The required mitigation is
 * redundant encoding, so severity is *always* rendered with its written label
 * and a distinct glyph beside the colour, and magnitude is carried
 * independently by bar length. Colour never carries meaning alone anywhere in
 * this UI.
 *
 * The product accent (cyan→indigo) is deliberately far from this ramp in hue,
 * so decorative chrome can never be mistaken for a risk signal.
 */
export interface SeverityMeta {
  label: string;
  color: string;
  /** Tinted fill for badges and pills. */
  bg: string;
  border: string;
  /** Very low-alpha wash for large areas. */
  soft: string;
  /** Outer glow used sparingly on the headline score only. */
  glow: string;
  /** Redundant, non-colour channel for the severity level. */
  glyph: string;
}

export const SEVERITY_META: Record<Severity, SeverityMeta> = {
  none: {
    label: "No concern",
    color: "#22c55e",
    bg: "rgba(34,197,94,0.12)",
    border: "rgba(34,197,94,0.34)",
    soft: "rgba(34,197,94,0.06)",
    glow: "rgba(34,197,94,0.30)",
    glyph: "✓",
  },
  low: {
    label: "Low",
    color: "#a3c940",
    bg: "rgba(163,201,64,0.12)",
    border: "rgba(163,201,64,0.34)",
    soft: "rgba(163,201,64,0.06)",
    glow: "rgba(163,201,64,0.30)",
    glyph: "·",
  },
  medium: {
    label: "Medium",
    color: "#fab219",
    bg: "rgba(250,178,25,0.12)",
    border: "rgba(250,178,25,0.34)",
    soft: "rgba(250,178,25,0.06)",
    glow: "rgba(250,178,25,0.30)",
    glyph: "▲",
  },
  high: {
    label: "High",
    color: "#ec835a",
    bg: "rgba(236,131,90,0.14)",
    border: "rgba(236,131,90,0.4)",
    soft: "rgba(236,131,90,0.07)",
    glow: "rgba(236,131,90,0.34)",
    glyph: "▲▲",
  },
  critical: {
    label: "Critical",
    color: "#e5484d",
    bg: "rgba(229,72,77,0.14)",
    border: "rgba(229,72,77,0.45)",
    soft: "rgba(229,72,77,0.07)",
    glow: "rgba(229,72,77,0.38)",
    glyph: "■",
  },
};

export const UNAVAILABLE_META: SeverityMeta = {
  label: "Not measured",
  color: "#6f778c",
  bg: "rgba(111,119,140,0.12)",
  border: "rgba(111,119,140,0.3)",
  soft: "rgba(111,119,140,0.05)",
  glow: "rgba(111,119,140,0.2)",
  glyph: "–",
};

/** Display order, worst first. */
export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "none"];

/** Maps a 0-100 risk score onto the same status ramp used for signals. */
export function scoreColor(score: number): string {
  if (score < 20) return SEVERITY_META.none.color;
  if (score < 40) return SEVERITY_META.low.color;
  if (score < 60) return SEVERITY_META.medium.color;
  if (score < 80) return SEVERITY_META.high.color;
  return SEVERITY_META.critical.color;
}

/** The full severity token set matching a score, for glow and tint. */
export function scoreMeta(score: number | null): SeverityMeta {
  if (score === null) return UNAVAILABLE_META;
  if (score < 20) return SEVERITY_META.none;
  if (score < 40) return SEVERITY_META.low;
  if (score < 60) return SEVERITY_META.medium;
  if (score < 80) return SEVERITY_META.high;
  return SEVERITY_META.critical;
}

/** One line telling the reader what the headline number actually means. */
export const CLASSIFICATION_SUMMARY: Record<RiskClassification, string> = {
  "Low Risk Signals":
    "Few risk signals were detected. This is not a safety guarantee — it means the checks below found little to flag.",
  "Moderate Risk Signals":
    "Some risk signals were detected. Read the flagged signals below before drawing a conclusion.",
  "Elevated Risk Signals":
    "Several meaningful risk signals were detected. Review the flagged signals carefully.",
  "High Risk Signals":
    "Many significant risk signals were detected across multiple categories.",
  "Critical Risk Signals":
    "Severe risk signals were detected across most categories that could be measured.",
  "Insufficient Data":
    "Too little data could be retrieved to produce a meaningful overall score. The individual signals below are still valid.",
};

/** Short form of the classification, for compact chrome like the sticky rail. */
export const CLASSIFICATION_SHORT: Record<RiskClassification, string> = {
  "Low Risk Signals": "Low",
  "Moderate Risk Signals": "Moderate",
  "Elevated Risk Signals": "Elevated",
  "High Risk Signals": "High",
  "Critical Risk Signals": "Critical",
  "Insufficient Data": "No score",
};
