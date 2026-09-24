import styles from "./ProductTour.module.css";

/**
 * Step position, stated once for sighted users as dots and once for assistive
 * technology as text. The dots are decorative and not focusable — navigation
 * is the job of the controls beside them.
 */
export default function TourProgress({
  index,
  total,
  label,
}: {
  index: number;
  total: number;
  label: string;
}) {
  return (
    <div className={styles.progress}>
      <span className={styles.dots} aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`${styles.dot}${i === index ? ` ${styles.dotActive}` : ""}`}
          />
        ))}
      </span>
      <span className={styles.progressText} data-tour-progress={`${index + 1}/${total}`}>
        {label}
      </span>
    </div>
  );
}
