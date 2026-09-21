"use client";

import { useEffect, useState } from "react";

import type { RiskReport } from "@/lib/risk-engine/types";

import RiskSummary from "./RiskSummary";
import TokenPanel from "./TokenPanel";
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
 *
 * The snapshot itself lives in `TokenPanel`, which is rendered twice: once in
 * this sticky rail on desktop, and once as an inline summary on narrower
 * screens where a permanent sidebar has nowhere to sit. Only one is ever
 * displayed. The section navigation stays with the rail, because it is a
 * desktop affordance — on a narrow screen the report is a single column and
 * scrolling is the navigation.
 *
 * The rail is two blocks, and only the second one sticks.
 *
 * The snapshot sits in normal document flow and scrolls away with the page:
 * once a reader is deep in the evidence, the token's market figures are
 * context they have already taken in. The verdict and the navigation beneath
 * it are one sticky group, so the answer stays on screen with the means of
 * moving around the argument for it. The handoff is the page scrolling, not a
 * state change, so nothing jumps.
 *
 * This replaces pinning the whole rail, which only worked on viewports tall
 * enough to hold all of it and otherwise left the navigation below the fold.
 * There is still no scroll container anywhere in here: the page remains the
 * only thing that scrolls.
 *
 * The sticky group is deliberately outside the snapshot's card. `overflow:
 * hidden` on an ancestor makes it that element's scroll container, and a
 * sticky element inside one that never scrolls simply never sticks.
 */
export default function SummaryRail({ report }: { report: RiskReport }) {
  const sections = buildSections(report);
  const active = useActiveSection(sections.map((s) => s.id));

  return (
    <>
      {/* Desktop: the persistent rail. */}
      <aside className={styles.rail} aria-label="Report summary">
        <div className={`card card-lit ${styles.panel}`}>
          <TokenPanel report={report} />
        </div>

        <div className={`card card-lit ${styles.sticky}`}>
          <RiskSummary report={report} />

          <nav className={styles.nav} aria-label="Report sections">
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
      </aside>

      {/* Narrow screens: the same panel, inline and full width. */}
      <section className={`xl:hidden ${styles.inline}`} aria-label="Token snapshot">
        <div className={`card card-lit ${styles.panel}`}>
          <TokenPanel report={report} />
        </div>
      </section>
    </>
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
