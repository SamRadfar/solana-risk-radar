"use client";

import { useEffect, useState } from "react";

import styles from "./SiteHeader.module.css";

/**
 * The site header.
 *
 * Adapts to application state rather than being two components: on the landing
 * it points at the one real landing section and offers "Analyse token"; once a
 * report exists it points at the report's own sections and offers "Analyse
 * another token".
 *
 * Navigation only ever links to anchors that actually exist in the DOM. There
 * is no "How it works" or "Methodology" entry because the app has no such
 * section or route — inventing them would be navigation that lies.
 */

interface NavItem {
  label: string;
  id: string;
}

/* The landing renders exactly one section besides the hero. */
const LANDING_NAV: NavItem[] = [{ label: "Signals", id: "what-gets-checked" }];

/* All three are rendered unconditionally by ReportView. */
const RESULT_NAV: NavItem[] = [
  { label: "Verdict", id: "verdict" },
  { label: "Profile", id: "profile" },
  { label: "Sources", id: "sources" },
];

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

        <button type="button" className={styles.cta} onClick={focusAnalyser}>
          {mode === "landing" ? "Analyse token" : "Analyse another token"}
        </button>
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

/** Brings the analyser into view and puts the caret in it. */
function focusAnalyser() {
  const input = document.getElementById("mint-address");
  if (!input) return;

  const reduce = prefersReducedMotion();
  input.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  // Focus once the smooth scroll has settled, so focusing does not fight it.
  window.setTimeout(() => input.focus({ preventScroll: true }), reduce ? 0 : 420);
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
