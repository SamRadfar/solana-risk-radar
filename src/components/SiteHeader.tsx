"use client";

import { useEffect, useState } from "react";

import styles from "./SiteHeader.module.css";

/**
 * The site header.
 *
 * Adapts to application state rather than being two components: the landing
 * carries no section links at all, while a report exposes its own sections.
 *
 * Navigation only ever links to anchors that actually exist in the DOM. There
 * is no "How it works" or "Methodology" entry because the app has no such
 * section or route — inventing them would be navigation that lies.
 *
 * The one standing action is the scoring explainer, which is why the header
 * does not also offer to analyse a token: the analyser is already the centre
 * of the landing page, and the report has its own way back to it.
 */

interface NavItem {
  label: string;
  id: string;
}

/*
 * The landing has no nav items. Its only section besides the hero is the one
 * the scoring CTA already leads to, and listing it twice would be two links to
 * the same place.
 */
const LANDING_NAV: NavItem[] = [];

/*
 * Both are rendered unconditionally by ReportView. "Profile" is deliberately
 * absent: it is the category breakdown, which is exactly where the scoring CTA
 * goes, so a nav entry for it would be the same redundancy.
 */
const RESULT_NAV: NavItem[] = [
  { label: "Verdict", id: "verdict" },
  { label: "Sources", id: "sources" },
];

/*
 * Where "How scoring works" leads, per state. Neither is a new section: the
 * landing's signal lanes name the five dimensions and the 14 signals, and the
 * report's category profile shows how each one was weighted and charged. The
 * CTA connects the existing explanations rather than adding a page.
 */
const SCORING_TARGET: Record<"landing" | "result", string> = {
  landing: "what-gets-checked",
  result: "profile",
};

export default function SiteHeader({
  mode,
  onReset,
}: {
  mode: "landing" | "result";
  onReset: () => void;
}) {
  const scrolled = useScrolled(6);
  const nav = mode === "landing" ? LANDING_NAV : RESULT_NAV;
  const canReset = mode === "result";
  const scoringTarget = SCORING_TARGET[mode];

  return (
    <header
      className={`${styles.header}${scrolled ? ` ${styles.scrolled}` : ""}`}
      data-scrolled={scrolled ? "true" : "false"}
    >
      <div className={styles.inner}>
        {canReset ? (
          <button
            type="button"
            onClick={onReset}
            className={`${styles.brand} ${styles.brandAction}`}
            aria-label="Start a new analysis"
          >
            <Brand />
          </button>
        ) : (
          <div className={styles.brand}>
            <Brand />
          </div>
        )}

        {/* Rendered only when there is something to list, so the landing does
            not carry an empty element and its flex gap. */}
        {nav.length > 0 && (
          <nav className={styles.nav} aria-label="Primary">
            {nav.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={styles.navLink}
                onClick={(event) => {
                  event.preventDefault();
                  scrollToId(item.id);
                }}
              >
                {item.label}
              </a>
            ))}
          </nav>
        )}

        <div className={styles.spacer} />

        {/*
          Product metadata rather than three buttons: one capsule, dot
          indicators, hairline separators, and deliberately quieter than the
          action beside it.
        */}
        <div className={styles.trust} aria-label="Product guarantees">
          <span className={styles.trustItem}>
            <span className={styles.dot} aria-hidden="true" />
            Deterministic
          </span>
          <span className={styles.sep} aria-hidden="true" />
          <span className={styles.trustItem}>No API keys</span>
          <span className={`${styles.sep} ${styles.trustOptional}`} aria-hidden="true" />
          <span className={`${styles.trustItem} ${styles.trustOptional}`}>
            Evidence-backed
          </span>
        </div>

        {/*
          A link, not a button: it navigates to an explanation that exists in
          the page, so it behaves like one — and it is deliberately quieter
          than the analyser it sits above.
        */}
        <a
          href={`#${scoringTarget}`}
          className={styles.cta}
          onClick={(event) => {
            event.preventDefault();
            scrollToId(scoringTarget);
          }}
        >
          How scoring works
          <span className={styles.ctaArrow} aria-hidden="true">
            &rarr;
          </span>
        </a>
      </div>
    </header>
  );
}

function Brand() {
  return (
    <>
      <span className={styles.mark} aria-hidden="true">
        {/*
          The identity mark: concentric range rings, a sweep arm and a locked
          target. Built from the product's own idea of a radar rather than
          borrowing any existing chain or brand logo.
        */}
        <svg width="19" height="19" viewBox="0 0 20 20" fill="none">
          <defs>
            <linearGradient id="rr-sweep" x1="10" y1="10" x2="17" y2="4">
              <stop offset="0%" stopColor="#38d6ec" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#38d6ec" />
            </linearGradient>
          </defs>
          <circle cx="10" cy="10" r="8" stroke="rgba(255,255,255,0.2)" strokeWidth="1.1" />
          <circle cx="10" cy="10" r="4.7" stroke="rgba(255,255,255,0.16)" strokeWidth="1.1" />
          <path
            d="M10 10L16.2 4.6"
            stroke="url(#rr-sweep)"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <circle cx="10" cy="10" r="1.5" fill="#38d6ec" />
          <circle cx="15.4" cy="13.6" r="1.25" fill="#6366f1" />
        </svg>
      </span>

      <span className={styles.brandText}>
        <span className={styles.name}>Solana Risk Radar</span>
        <span className={styles.tagline}>Deterministic risk signals, not predictions</span>
      </span>
    </>
  );
}

/* -------------------------------------------------------------------------- */

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Scrolls an anchor clear of the sticky bar.
 *
 * Done in JS with an explicit offset rather than by adding scroll-margin to
 * each target, so no other component needs editing to make the nav land
 * correctly.
 */
function scrollToId(id: string) {
  const element = document.getElementById(id);
  if (!element) return;

  const headerHeight =
    parseInt(
      getComputedStyle(document.documentElement).getPropertyValue("--header-h"),
      10,
    ) || 68;

  const top = element.getBoundingClientRect().top + window.scrollY - headerHeight - 20;
  window.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

/**
 * Tracks whether the page has moved past a small threshold.
 *
 * Reads are throttled to one per frame and the listener is passive, so the
 * header costs nothing while scrolling.
 */
function useScrolled(threshold: number): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let ticking = false;

    const update = () => {
      ticking = false;
      setScrolled(window.scrollY > threshold);
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  return scrolled;
}
