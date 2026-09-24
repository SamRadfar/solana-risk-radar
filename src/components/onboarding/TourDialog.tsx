"use client";

import { useCallback, useEffect, useId, useRef } from "react";

import styles from "./ProductTour.module.css";
import TourControls from "./TourControls";
import TourProgress from "./TourProgress";
import TourSpotlight from "./TourSpotlight";
import TourVisual from "./TourVisual";
import type { ProductTourController } from "./useProductTour";
import type { TourDefinition } from "./tourSteps";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The tour modal.
 *
 * A real dialog: labelled by its own heading, described by its body, modal to
 * assistive technology, focus-trapped while open and returning focus to
 * whatever opened it. Escape always closes, so the user is never held here.
 */
export default function TourDialog({
  tour,
  controller,
}: {
  tour: TourDefinition;
  controller: ProductTourController;
}) {
  const { open, step, isFirst, isLast, index, total, progress } = controller;

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();

  const primary = useCallback(() => {
    if (isLast) controller.finish();
    else controller.next();
  }, [isLast, controller]);

  /* Remember what had focus, and give it back on close. */
  useEffect(() => {
    if (!open) return;

    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Focus the dialog itself rather than the primary button, so a screen
    // reader announces the step before the action.
    const frame = requestAnimationFrame(() => dialogRef.current?.focus());

    return () => {
      cancelAnimationFrame(frame);
      restoreRef.current?.focus?.();
    };
  }, [open]);

  /* Hold the page still underneath. */
  useEffect(() => {
    if (!open) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  /* Keyboard: Escape closes, arrows move, Tab stays inside. */
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        controller.skip();
        return;
      }

      if (event.key === "Tab") {
        const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (!nodes || nodes.length === 0) return;

        const list = Array.from(nodes).filter((n) => n.offsetParent !== null);
        if (list.length === 0) return;

        const first = list[0];
        const last = list[list.length - 1];
        const active = document.activeElement;

        if (event.shiftKey && (active === first || active === dialogRef.current)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }

      // Arrows are a convenience, never a hijack: if the user is typing, the
      // field keeps them.
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      if (typing) return;

      if (event.key === "ArrowRight") {
        event.preventDefault();
        primary();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        controller.back();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, controller, primary]);

  if (!open || !step) return null;

  return (
    <div className={styles.layer} data-tour-open="true">
      {/* Dims and blurs the app without hiding it, and swallows stray clicks. */}
      <div className={styles.backdrop} onClick={controller.skip} aria-hidden="true" />

      <TourSpotlight selector={step.target} dialogRef={dialogRef} />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className={styles.dialog}
      >
        <button
          type="button"
          className={styles.close}
          onClick={controller.skip}
          aria-label="Close product tour"
        >
          <span aria-hidden="true">&times;</span>
        </button>

        {/* Keyed on the step so each one crossfades in as its own element. */}
        <div key={step.id} className={styles.body}>
          <div className={styles.copy}>
            <p className={styles.eyebrow}>{tour.label}</p>
            <h2 id={titleId} className={styles.title}>
              {step.title}
            </h2>
            <p id={bodyId} className={styles.description}>
              {step.description}
            </p>
          </div>

          <TourVisual step={step} />
        </div>

        <div className={styles.footer}>
          <TourProgress index={index} total={total} label={progress} />
          <TourControls
            isFirst={isFirst}
            isLast={isLast}
            primaryLabel={step.primaryLabel ?? "Next"}
            onBack={controller.back}
            onNext={primary}
            onSkip={controller.skip}
          />
        </div>

        {/* Announces movement for screen readers without moving focus. */}
        <span className="sr-only" aria-live="polite">
          Step {index + 1} of {total}: {step.title}
        </span>
      </div>
    </div>
  );
}
