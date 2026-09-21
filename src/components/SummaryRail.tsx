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
import styles from "./SummaryRail.module.css";

/**
 * The persistent right-hand rail (desktop only).
 *
 * Holds the context a reader needs at every scroll position — what the token
 * is, what the verdict is, how many findings there are, and where they are in
 * the report. Everything here is a *summary*; the argument itself lives in the
 * main column, so nothing is duplicated between the two.
 *
 * One surface, divided internally. Four stacked cards repeated the page's own
 * problem at a smaller scale; the divisions between these parts are
 * differences of subject, not of container, so they are drawn as hairlines.
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
  const totalSignals = counts.reduce((sum, entry) => sum + entry.value, 0);

  return (
    <aside
      className={`hidden xl:block ${styles.rail}`}
      style={{ top: "calc(var(--header-h) + 20px)" }}
      aria-label="Report summary"
    >
      <div className={`card card-lit ${styles.panel}`}>
        <div className={styles.verdict}>
          <ScoreDial
            score={report.score}
            classification={report.classification}
            size={104}
            compact
          />
          <div className={styles.identity}>
            <div className={styles.nameRow}>
              {overview.imageUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={overview.imageUrl} alt="" className={styles.avatar} />
              )}
              <span className={styles.name}>{overview.name ?? "Unnamed token"}</span>
            </div>
            {symbol && <div className={`font-mono ${styles.symbol}`}>{symbol}</div>}
            <div className={styles.class} style={{ color: meta.color }}>
              {CLASSIFICATION_SHORT[report.classification]} risk
            </div>
            {report.coveragePercent < 100 && (
              <div className={styles.coverage}>{report.coveragePercent}% coverage</div>
            )}
          </div>
        </div>

        <a
          href={explorerTokenUrl(overview.mint)}
          target="_blank"
          rel="noopener noreferrer"
          className={`font-mono ${styles.mint}`}
        >
          <span className={styles.mintAddress}>{truncateAddress(overview.mint, 10)}</span>
          <span style={{ color: "var(--accent)" }}>↗</span>
        </a>

        <div className={styles.block}>
          <div className={styles.eyebrowRow}>
            <span className="eyebrow">Findings</span>
            <span className={`tnum ${styles.total}`}>{totalSignals} signals</span>
          </div>
          <ul className={styles.findings}>
            {counts.map(({ key, value }) => {
              const m = key === "unavailable" ? UNAVAILABLE_META : SEVERITY_META[key];
              const dim = value === 0;
              return (
                <li key={key} className={styles.finding}>
                  <span
                    aria-hidden="true"
                    className={styles.findingGlyph}
                    style={{ color: dim ? "var(--ink-faint)" : m.color }}
                  >
                    {m.glyph}
                  </span>
                  <span
                    className={`tnum ${styles.findingCount}`}
                    style={{ color: dim ? "var(--ink-faint)" : m.color }}
                  >
                    {value}
                  </span>
                  <span className={styles.findingLabel}>{m.label}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className={styles.block}>
          <div className={styles.eyebrowRow}>
            <span className="eyebrow">Market</span>
          </div>
          <dl className={styles.metrics}>
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

        <nav className={`${styles.block} ${styles.nav}`} aria-label="Report sections">
          <ul className={styles.navList}>
            {sections.map((section) => {
              const isActive = active === section.id;
              return (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    aria-current={isActive ? "true" : undefined}
                    className={styles.navLink}
                  >
                    <span className={styles.navInner}>
                      <span aria-hidden="true" className={styles.navTick} />
                      <span className={styles.navLabel}>{section.label}</span>
                    </span>
                    {section.count !== undefined && (
                      <span className={`tnum ${styles.navCount}`}>{section.count}</span>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      <p className={`tnum ${styles.footnote}`}>
        Analysed in {(report.elapsedMs / 1000).toFixed(1)}s · {report.availableWeight}/
        {report.totalWeight} signal weight measurable
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
    <div className={styles.metricRow}>
      <dt className={styles.metricLabel}>{label}</dt>
      <dd className={`tnum ${styles.metricValue} ${mono ? "font-mono" : ""}`}>{value}</dd>
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
