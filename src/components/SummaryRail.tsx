"use client";

import { useEffect, useState } from "react";

import type { RiskReport, Severity } from "@/lib/risk-engine/types";
import {
  CLASSIFICATION_SHORT,
  SEVERITY_META,
  UNAVAILABLE_META,
  scoreMeta,
} from "@/lib/severity";
import { explorerTokenUrl } from "@/lib/solana/knownAddresses";
import { formatPrice, formatUsd, truncateAddress } from "@/lib/format";

import ScoreDial from "./ScoreDial";
import { buildSections } from "./sections";

/**
 * The persistent right-hand rail (desktop only).
 *
 * Holds the context a reader needs at every scroll position — what the token
 * is, what the verdict is, how many findings there are, and where they are in
 * the report. Everything here is a *summary*; the argument itself lives in the
 * main column, so nothing is duplicated between the two.
 */
export default function SummaryRail({ report }: { report: RiskReport }) {
  const sections = buildSections(report);
  const active = useActiveSection(sections.map((s) => s.id));

  const { overview, summary } = report;
  const meta = scoreMeta(report.score);
  const symbol = overview.symbol?.toUpperCase() ?? null;

  const counts: { key: Severity | "unavailable"; value: number }[] = [
    { key: "critical", value: summary.counts.critical },
    { key: "high", value: summary.counts.high },
    { key: "medium", value: summary.counts.medium },
    { key: "low", value: summary.counts.low },
    { key: "none", value: summary.counts.none },
    { key: "unavailable", value: summary.counts.unavailable },
  ];

  return (
    <aside
      className="hidden xl:flex flex-col gap-3 w-[332px] shrink-0 sticky self-start"
      style={{ top: "calc(var(--header-h) + 20px)" }}
      aria-label="Report summary"
    >
      {/* Verdict */}
      <div className="card card-lit p-5">
        <div className="flex items-center gap-4">
          <ScoreDial
            score={report.score}
            classification={report.classification}
            size={104}
            compact
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              {overview.imageUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={overview.imageUrl}
                  alt=""
                  className="h-6 w-6 rounded-full object-cover shrink-0"
                  style={{ border: "1px solid var(--line)" }}
                />
              )}
              <span className="font-semibold truncate text-[15px]">
                {overview.name ?? "Unnamed token"}
              </span>
            </div>
            {symbol && (
              <div
                className="font-mono text-[11px] mt-0.5"
                style={{ color: "var(--ink-muted)" }}
              >
                {symbol}
              </div>
            )}
            <div
              className="mt-2 text-[13px] font-medium"
              style={{ color: meta.color }}
            >
              {CLASSIFICATION_SHORT[report.classification]} risk
            </div>
            {report.coveragePercent < 100 && (
              <div className="text-[11px] mt-0.5" style={{ color: "var(--ink-muted)" }}>
                {report.coveragePercent}% coverage
              </div>
            )}
          </div>
        </div>

        <a
          href={explorerTokenUrl(overview.mint)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex items-center justify-between gap-2 inset px-3 py-2 font-mono text-[11px] transition-colors hover:border-[var(--line-accent)]"
          style={{ color: "var(--ink-secondary)" }}
        >
          <span className="truncate">{truncateAddress(overview.mint, 10)}</span>
          <span style={{ color: "var(--accent)" }}>↗</span>
        </a>
      </div>

      {/* Findings */}
      <div className="card p-4">
        <div className="eyebrow mb-3">Findings</div>
        <div className="grid grid-cols-3 gap-2">
          {counts.map(({ key, value }) => {
            const m = key === "unavailable" ? UNAVAILABLE_META : SEVERITY_META[key];
            const dim = value === 0;
            return (
              <div
                key={key}
                className="inset px-2 py-2 text-center"
                style={{
                  borderColor: dim ? "var(--line)" : m.border,
                  background: dim ? "var(--surface-inset)" : m.soft,
                }}
              >
                <div
                  className="tnum text-lg font-semibold leading-none"
                  style={{ color: dim ? "var(--ink-faint)" : m.color }}
                >
                  {value}
                </div>
                <div
                  className="text-[10px] mt-1 leading-tight"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {m.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Key metrics */}
      <div className="card p-4">
        <div className="eyebrow mb-3">Market</div>
        <dl className="space-y-2 text-[13px]">
          <Row
            label="Price"
            value={overview.priceUsd !== null ? formatPrice(overview.priceUsd) : "—"}
          />
          <Row
            label="Market cap"
            value={overview.marketCapUsd !== null ? formatUsd(overview.marketCapUsd) : "—"}
          />
          <Row label="Program" value={overview.tokenProgram} mono />
        </dl>
      </div>

      {/* Navigation */}
      <nav className="card p-2" aria-label="Report sections">
        <ul>
          {sections.map((section) => {
            const isActive = active === section.id;
            return (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  aria-current={isActive ? "true" : undefined}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-[10px] text-[13px] transition-colors"
                  style={{
                    color: isActive ? "var(--ink)" : "var(--ink-muted)",
                    background: isActive ? "rgba(56,214,236,0.08)" : "transparent",
                  }}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span
                      aria-hidden="true"
                      className="h-3.5 w-[2px] rounded-full shrink-0 transition-colors"
                      style={{
                        background: isActive ? "var(--accent)" : "var(--line-strong)",
                      }}
                    />
                    <span className="truncate">{section.label}</span>
                  </span>
                  {section.count !== undefined && (
                    <span
                      className="tnum text-[11px] shrink-0"
                      style={{ color: "var(--ink-faint)" }}
                    >
                      {section.count}
                    </span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <p className="text-[11px] leading-relaxed px-1" style={{ color: "var(--ink-faint)" }}>
        Analysed in {(report.elapsedMs / 1000).toFixed(1)}s ·{" "}
        {report.availableWeight}/{report.totalWeight} signal weight measurable
      </p>
    </aside>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt style={{ color: "var(--ink-muted)" }}>{label}</dt>
      <dd className={`tnum truncate ${mono ? "font-mono text-[12px]" : ""}`}>{value}</dd>
    </div>
  );
}

/**
 * Scroll-spy.
 *
 * The observer band sits in the upper third of the viewport, so the "current"
 * section is the one the reader is actually looking at rather than whatever
 * happens to touch the very top edge.
 */
function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  const key = ids.join("|");

  useEffect(() => {
    const sectionIds = key.split("|").filter(Boolean);
    if (sectionIds.length === 0) return;

    const visible = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.set(entry.target.id, entry.intersectionRatio);
          else visible.delete(entry.target.id);
        }

        // Pick the visible section nearest the top of the document order.
        const current = sectionIds.find((id) => visible.has(id));
        if (current) setActive(current);
      },
      { rootMargin: "-12% 0px -68% 0px", threshold: [0, 0.25, 0.6] },
    );

    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [key]);

  return active;
}
