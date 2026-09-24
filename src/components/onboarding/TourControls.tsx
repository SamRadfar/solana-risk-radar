import styles from "./ProductTour.module.css";

/**
 * Back / Next, plus the standing way out.
 *
 * Back is rendered but disabled on the first step rather than removed, so the
 * primary action does not jump sideways between steps one and two.
 */
export default function TourControls({
  isFirst,
  isLast,
  primaryLabel,
  onBack,
  onNext,
  onSkip,
}: {
  isFirst: boolean;
  isLast: boolean;
  primaryLabel: string;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  return (
    <div className={styles.controls}>
      <button type="button" className={styles.skip} onClick={onSkip}>
        Skip tour
      </button>

      <div className={styles.controlPair}>
        <button
          type="button"
          className={styles.back}
          onClick={onBack}
          disabled={isFirst}
        >
          Back
        </button>
        <button
          type="button"
          className={`btn-accent ${styles.nextBtn}`}
          onClick={onNext}
          data-tour-primary="true"
        >
          {primaryLabel}
          {!isLast && (
            <span className={styles.nextArrow} aria-hidden="true">
              &rarr;
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
