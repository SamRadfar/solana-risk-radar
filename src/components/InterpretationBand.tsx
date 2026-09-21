import type { CSSProperties } from "react";

import { interpretCategories } from "@/lib/interpretation";
import type { RiskReport } from "@/lib/risk-engine/types";
import { scoreColor, scoreMeta } from "@/lib/severity";

import Reveal from "./Reveal";
import styles from "./InterpretationBand.module.css";

/**
 * "What shaped this verdict" — the report's one editorial moment.
 *
 * It sits between the flagged signals and the clean ones, where the page is at
 * its most repetitive, and does two jobs at once: it gives the eye somewhere
 * to rest before the next dense block, and it answers a question none of the
 * cards can. Each card says how bad one thing is. This says where the risk
 * *came from* — which of the five categories the score was actually built out
 * of, as a proportion of everything charged.
 *
 * Every figure is derived from the report already on screen. Nothing is
 * recomputed, no new metric is invented, and the sentence is assembled by
 * fixed rules in `interpretCategories` rather than written by a model.
 */
export default function InterpretationBand({ report }: { report: RiskReport }) {
  const { contributions, unmeasured, totalPoints, sentence } = interpretCategories(
    report.categories,
  );
  const meta = scoreMeta(report.score);
  const { counts } = report.summary;
  const flagged = counts.critical + counts.high + counts.medium + counts.low;

  return (
    /*
     * The travel distance is deliberately left at the shared default rather
     * than raised here: an inline override would win over the stylesheet and
     * take the shorter mobile distance with it. What makes this reveal more
     * deliberate than the others is the strip growing in behind the text, not
     * the band moving further.
     */
    <Reveal
      as="section"
      className={styles.band}
      aria-labelledby="what-shaped-this"
      style={{ "--band-tint": meta.soft } as CSSProperties}
    >
      <hr className={`${styles.rule} ${styles.ruleTop}`} />

      <div className="eyebrow">Interpretation</div>
      <div className={styles.mark} aria-hidden="true" />

      <h3 id="what-shaped-this" className={`display ${styles.headline}`}>
        What shaped this verdict
      </h3>

      <p className={styles.sentence}>{sentence}</p>

      {totalPoints > 0 && (
        <div className={styles.stripWrap}>
          <div className={styles.stripLabel}>
            <span className="eyebrow">Where the measured risk came from</span>
            {/*
              Both encodings are stated, because they answer different
              questions: a category can be a large share of a small total, and
              a reader who assumes the colour means the width would misread it.
            */}
            <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
              Width is share of the risk charged · colour is that category&rsquo;s intensity
            </span>
          </div>

          {/*
            Decorative: the lanes below carry the same figures as text, so the
            strip adds shape rather than information a reader could only get
            by looking at colour.
          */}
          <div className={styles.strip} aria-hidden="true">
            {contributions
              .filter((contribution) => contribution.points > 0)
              .map((contribution) => (
                <span
                  key={contribution.category}
                  className={styles.segment}
                  style={{
                    flexGrow: contribution.share,
                    flexBasis: 0,
                    background: scoreColor(contribution.percent),
                  }}
                />
              ))}
          </div>
        </div>
      )}

      <ul className={styles.lanes}>
        {contributions.map((contribution) => {
          const color = scoreColor(contribution.percent);
          const clean = contribution.points === 0;
          return (
            <li key={contribution.category} className={styles.lane}>
              <div className={styles.laneTop}>
                <span
                  className={styles.dot}
                  aria-hidden="true"
                  style={{ background: color }}
                />
                <span className={styles.laneName}>{contribution.category}</span>
              </div>
              <div className={`tnum ${styles.laneValue}`} style={{ color }}>
                {contribution.sharePercent}%
              </div>
              <div className={styles.laneNote}>
                {clean ? "nothing charged" : "of charged risk"}
              </div>
            </li>
          );
        })}

        {unmeasured.map((category) => (
          <li key={category} className={styles.lane}>
            <div className={styles.laneTop}>
              <span
                className={styles.dot}
                aria-hidden="true"
                style={{ background: "var(--ink-faint)" }}
              />
              <span className={styles.laneName}>{category}</span>
            </div>
            <div
              className={`tnum ${styles.laneValue}`}
              style={{ color: "var(--ink-faint)" }}
            >
              —
            </div>
            <div className={styles.laneNote}>not measured</div>
          </li>
        ))}
      </ul>

      <div className={styles.stats}>
        <Stat
          value={report.score === null ? "—" : String(report.score)}
          label={`Risk score · ${report.classification}`}
          color={meta.color}
        />
        <Stat value={`${report.coveragePercent}%`} label="Signal coverage" />
        <Stat value={String(flagged)} label={flagged === 1 ? "flagged signal" : "flagged signals"} />
        <Stat value={String(counts.none)} label="with no concern" />
      </div>

      <hr className={`${styles.rule} ${styles.ruleBottom}`} />
    </Reveal>
  );
}

function Stat({
  value,
  label,
  color,
}: {
  value: string;
  label: string;
  color?: string;
}) {
  return (
    <div className={styles.stat}>
      <span className={`tnum ${styles.statValue}`} style={color ? { color } : undefined}>
        {value}
      </span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}
