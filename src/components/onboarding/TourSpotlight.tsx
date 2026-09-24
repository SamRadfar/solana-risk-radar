"use client";

import { useEffect, useState, type RefObject } from "react";

import styles from "./ProductTour.module.css";
import { resolveTarget, shouldHighlight, type Rect } from "./tourTarget";

function toRect(element: Element): Rect {
  const r = element.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/**
 * A hairline ring around the live element a step refers to.
 *
 * Entirely optional: when the selector matches nothing, or the element sits
 * behind the dialog, nothing is rendered and the step is unaffected. The ring
 * is inert — `pointer-events: none` — so it can never intercept a click.
 */
export default function TourSpotlight({
  selector,
  dialogRef,
}: {
  selector: string | undefined;
  dialogRef: RefObject<HTMLElement | null>;
}) {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    const measure = () => {
      const target = selector ? resolveTarget(selector) : null;
      if (!target) {
        setRect(null);
        return;
      }

      const targetRect = toRect(target);
      const dialogRect = dialogRef.current ? toRect(dialogRef.current) : null;
      setRect(shouldHighlight(targetRect, dialogRect) ? targetRect : null);
    };

    // Always measured a frame later, never synchronously in the effect body,
    // so the dialog has been laid out and can be compared against.
    const frame = requestAnimationFrame(measure);

    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
    };
  }, [selector, dialogRef]);

  if (!rect) return null;

  return (
    <div
      className={styles.spotlight}
      aria-hidden="true"
      style={{
        top: rect.top - 6,
        left: rect.left - 6,
        width: rect.width + 12,
        height: rect.height + 12,
      }}
    />
  );
}
