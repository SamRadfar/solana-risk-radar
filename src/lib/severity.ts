import type { RiskClassification, Severity } from "./risk-engine/types";

/**
 * Severity is a *status* scale, not a categorical one, so it follows the status
 * palette rules: reserved colours, and never colour alone.
 *
 * These five steps were validated against the dark chart surface (#0e1015):
 * every step clears 3:1 contrast. Adjacent pairs in the yellow-to-orange region
 * cannot reach the ΔE ≥ 15 separation floor — that is intrinsic to any ordered
 * green-to-red ramp, and holds even for a purpose-built status palette. The
 * required mitigation is redundant encoding, so severity is *always* rendered
 * with its written label and a distinct glyph beside the colour, and magnitude
 * is carried independently by bar length. Colour never carries meaning alone
 * anywhere in this UI.
 */
export interface SeverityMeta {
  label: string;
  color: string;
  bg: string;
  border: string;
  /** Redundant, non-colour channel for the severity level. */
  glyph: string;
}

export const SEVERITY_META: Record<Severity, SeverityMeta> = {
  none: {
    label: "No concern",
    color: "#22c55e",
    bg: "rgba(34,197,94,0.12)",
    border: "rgba(34,197,94,0.35)",
    glyph: "✓",
  },
  low: {
    label: "Low",
    color: "#a3c940",
    bg: "rgba(163,201,64,0.12)",
    border: "rgba(163,201,64,0.35)",
    glyph: "·",
  },
  medium: {
    label: "Medium",
    color: "#fab219",
    bg: "rgba(250,178,25,0.12)",
    border: "rgba(250,178,25,0.35)",
    glyph: "▲",
  },
  high: {
    label: "High",
    color: "#ec835a",
    bg: "rgba(236,131,90,0.14)",
    border: "rgba(236,131,90,0.4)",
    glyph: "▲▲",
  },
  critical: {
    label: "Critical",
    color: "#e5484d",
    bg: "rgba(229,72,77,0.14)",
    border: "rgba(229,72,77,0.45)",
    glyph: "■",
  },
};

export const UNAVAILABLE_META = {
  label: "Not measured",
  color: "#7d8496",
  bg: "rgba(125,132,150,0.1)",
  border: "rgba(125,132,150,0.3)",
  glyph: "–",
} as const;

/** Maps a 0-100 risk score onto the same status ramp used for signals. */
export function scoreColor(score: number): string {
  if (score < 15) return SEVERITY_META.none.color;
  if (score < 35) return SEVERITY_META.low.color;
  if (score < 60) return SEVERITY_META.medium.color;
  if (score < 80) return SEVERITY_META.high.color;
  return SEVERITY_META.critical.color;
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
