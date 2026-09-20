import type { Severity } from "./risk-engine/types";

export const SEVERITY_META: Record<Severity, { label: string; color: string; bg: string }> = {
  none: { label: "No Concern", color: "#3fb950", bg: "rgba(63,185,80,0.12)" },
  low: { label: "Low", color: "#7ee787", bg: "rgba(126,231,135,0.12)" },
  medium: { label: "Medium", color: "#e3b341", bg: "rgba(227,179,65,0.12)" },
  high: { label: "High", color: "#f0883e", bg: "rgba(240,136,62,0.12)" },
  critical: { label: "Critical", color: "#f85149", bg: "rgba(248,81,73,0.14)" },
};

export function scoreColor(score: number): string {
  if (score < 20) return "#3fb950";
  if (score < 45) return "#e3b341";
  if (score < 70) return "#f0883e";
  return "#f85149";
}
