import type { RiskReport } from "@/lib/risk-engine/types";

/**
 * The report's section registry.
 *
 * Built in one place so the sticky navigation and the rendered report can never
 * disagree: a section only appears in the nav if the report actually renders
 * it, and both read their id and label from here.
 */
export interface ReportSection {
  id: string;
  label: string;
  /** Optional count badge shown in the rail. */
  count?: number;
}

export function buildSections(report: RiskReport): ReportSection[] {
  const measured = report.signals.filter((s) => s.status === "ok");
  const flagged = measured.filter((s) => s.severity !== "none");
  const clean = measured.filter((s) => s.severity === "none");
  const unmeasured = report.signals.filter((s) => s.status === "unavailable");

  const sections: ReportSection[] = [
    { id: "verdict", label: "Verdict" },
    { id: "profile", label: "Risk profile" },
  ];

  if (flagged.length > 0) {
    sections.push({ id: "flagged", label: "Flagged signals", count: flagged.length });
  }
  if (clean.length > 0) {
    sections.push({ id: "clean", label: "No concern", count: clean.length });
  }
  sections.push({ id: "distribution", label: "Holders" });
  if (unmeasured.length > 0) {
    sections.push({ id: "unmeasured", label: "Not measured", count: unmeasured.length });
  }
  sections.push({ id: "sources", label: "Data sources" });

  return sections;
}
