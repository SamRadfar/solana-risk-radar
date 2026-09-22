"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { RiskCategory } from "@/lib/risk-engine/types";

import styles from "./CategoryHelp.module.css";

/**
 * What a risk category measures, on request.
 *
 * "Authorities" and "Maturity" mean something precise here and nothing obvious
 * to a reader meeting them for the first time. These say what the category
 * *measures* — never what this token scored, which is the row's own job.
 */
const MEANING: Record<RiskCategory, string> = {
  Authorities:
    "Checks whether the token can still be minted, frozen, or otherwise controlled by active authorities.",
  Holders:
    "Measures how concentrated the sellable token supply is among the largest wallets.",
  Liquidity:
    "Evaluates whether enough real market liquidity exists to buy or sell the token without excessive price impact.",
  "Market Activity":
    "Looks at recent trading activity to identify healthy, inactive, or potentially distorted market behaviour.",
  Maturity:
    "Measures how long the token and its active market have existed. Very new tokens have less historical evidence available.",
};

/** Long enough that brushing past a row does not trigger it. */
const HOVER_DELAY_MS = 400;
/** Keeps the panel off the viewport edge. */
const MARGIN = 12;
const WIDTH = 264;

interface Position {
  left: number;
  top: number;
  placement: "above" | "below";
}

export default function CategoryHelp({ category }: { category: RiskCategory }) {
  const [position, setPosition] = useState<Position | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | null>(null);
  const id = useId();

  const open = position !== null;

  const locate = useCallback((): Position | null => {
    const element = button.current;
    if (!element) return null;

    const rect = element.getBoundingClientRect();
    const centre = rect.left + rect.width / 2;

    // Clamped to the viewport rather than merely anchored to the icon, so a
    // row near either edge still gets a readable panel.
    const left = Math.min(
      Math.max(centre - WIDTH / 2, MARGIN),
      window.innerWidth - WIDTH - MARGIN,
    );

    // Above by default; below when there is not room, which is what keeps it
    // off the chart it would otherwise cover.
    const above = rect.top > 150;
    return {
      left,
      top: above ? rect.top - 10 : rect.bottom + 10,
      placement: above ? "above" : "below",
    };
  }, []);

  const show = useCallback(() => setPosition(locate()), [locate]);
  const hide = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setPosition(null);
  }, []);

  useEffect(() => {
    if (!open) return;

    // Dismissed by anything that means "I am looking elsewhere now".
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    const onOutside = (event: PointerEvent) => {
      if (!button.current?.contains(event.target as Node)) hide();
    };
    const onReflow = () => setPosition(locate());

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onOutside);
    window.addEventListener("scroll", onReflow, { passive: true, capture: true });
    window.addEventListener("resize", onReflow, { passive: true });

    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onOutside);
      window.removeEventListener("scroll", onReflow, { capture: true });
      window.removeEventListener("resize", onReflow);
    };
  }, [open, hide, locate]);

  // A stray timer must not fire a tooltip after the row has gone.
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  return (
    <>
      <button
        ref={button}
        type="button"
        className={styles.trigger}
        /* The icon alone is the control — the row around it stays inert. */
        aria-label={`What does ${category} measure?`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onPointerEnter={(event) => {
          // Touch is a tap, not a hover; the click handler owns that.
          if (event.pointerType !== "mouse") return;
          timer.current = window.setTimeout(show, HOVER_DELAY_MS);
        }}
        onPointerLeave={hide}
        onClick={() => (open ? hide() : show())}
        onFocus={(event) => {
          /*
           * Keyboard focus only. A pointer press focuses the button too, so
           * showing on every focus meant a tap opened the panel and the click
           * that followed immediately closed it again — the first tap on a
           * touch screen appeared to do nothing at all. `:focus-visible` is
           * exactly the distinction between "moved here with the keyboard"
           * and "pressed this", and where it is unsupported the check throws
           * and focus falls back to opening.
           */
          try {
            if (!event.currentTarget.matches(":focus-visible")) return;
          } catch {
            // No :focus-visible support — show, as before.
          }
          show();
        }}
        onBlur={hide}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path
            d="M6.35 6.2a1.7 1.7 0 0 1 3.3.55c0 1.1-1.65 1.35-1.65 2.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <circle cx="8" cy="11.6" r="0.75" fill="currentColor" />
        </svg>
      </button>

      {/*
        Portalled to the body on purpose. This sits inside a reveal wrapper,
        which always carries a transform, and a transformed ancestor becomes
        the containing block for `position: fixed` — the panel would be pinned
        to the list instead of the viewport, and every clamp above would be
        measured against the wrong box. Leaving the subtree is also what keeps
        it out of the document flow, so opening it shifts nothing.
      */}
      {open &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className={styles.panel}
            data-placement={position.placement}
            style={{ left: position.left, top: position.top, width: WIDTH }}
          >
            <span className={styles.heading}>{category}</span>
            <span className={styles.body}>{MEANING[category]}</span>
          </div>,
          document.body,
        )}
    </>
  );
}
