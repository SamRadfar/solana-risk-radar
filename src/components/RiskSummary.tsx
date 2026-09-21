import type { RiskReport, Severity } from "@/lib/risk-engine/types";
import { CLASSIFICATION_SHORT, scoreMeta } from "@/lib/severity";

import ScoreDial from "./ScoreDial";
import styles from "./RiskSummary.module.css";

/**
 * The verdict: score, gauge, classification and coverage.
 *
 * Lifted out of the token snapshot and attached to the navigation instead.
 * The snapshot describes the token and is read once; the verdict is the answer
 * the whole report argues for, and belongs with the element that persists
 * while the argument is being read. Nothing about the module itself changed in
 * the move — same dial at the same size, same type, same spacing — except that
 * it no longer draws a divider above itself, because it is now the first thing
 * in its surface rather than a section within one.
 */
export default function RiskSummary({ report }: { report: RiskReport }) {
  const meta = scoreMeta(report.score);
  const { counts } = report.summary;

  const keys: (Severity | "unavailable")[] = [
    "critical",
    "high",
    "medium",
    "low",
    "none",
    "unavailable",
  ];
  const totalSignals = keys.reduce((sum, key) => sum + counts[key], 0);

  return (
    <div className={styles.verdict}>
      <ScoreDial
        score={report.score}
        classification={report.classification}
        /*
         * Large enough that the dial's own fixed-size labels ("/ 100" and the
         * eyebrow) clear the arc's lower curve — they are absolute sizes, so
         * the smaller the dial, the more of the ring they sit on.
         */
        size={176}
      />
      <div className={styles.classification} style={{ color: meta.color }}>
        {CLASSIFICATION_SHORT[report.classification]} risk
      </div>
      <div className={styles.riskMeta}>
        {report.coveragePercent}% coverage · {totalSignals} signals
      </div>
    </div>
  );
}
