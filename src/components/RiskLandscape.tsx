import type { CSSProperties } from "react";

import { interpretCategories, type CategoryContribution } from "@/lib/interpretation";
import type { RiskReport } from "@/lib/risk-engine/types";
import { scoreColor, scoreMeta } from "@/lib/severity";

import Reveal from "./Reveal";
import styles from "./RiskLandscape.module.css";

/**
 * The risk landscape — the report's one editorial moment.
 *
 * It sits between the flagged signals and the clean ones, where the page is at
 * its most repetitive, and does two jobs: it gives the eye somewhere to rest
 * before the next dense block, and it answers a question none of the findings
 * can. Each finding says how bad one thing is. This says where the risk *came
 * from* — which of the five categories the score was actually built out of, as
 * a proportion of everything charged.
 *
 * The terrain is the data. Each measured category is one ridge, and its height
 * is its share of the charged risk: the tallest ridge is the category that
 * shaped the verdict. Nothing here is decorative shape-making — a category
 * that charged nothing is flat ground, and a category that could not be
 * measured is not drawn at all.
 *
 * Every figure comes from the report already on screen. Nothing is recomputed,
 * no new metric is invented, and the statement is assembled by fixed rules in
 * `interpretCategories` rather than written by a model.
 */

/* The ridge field's coordinate space. Stretched to fit by the stylesheet. */
const FIELD_WIDTH = 1000;
const FIELD_HEIGHT = 240;
const BASELINE = 212;
/** Tallest possible ridge, leaving room for a label above it. */
const MAX_AMPLITUDE = 168;
/** Ridge spread. Wide enough that neighbours overlap into a range. */
const SIGMA = 122;
const MARGIN = 110;
/** Half a peak label's width in field units — what it has to clear. */
const LABEL_HALF_WIDTH = 78;

interface Ridge {
  contribution: CategoryContribution;
  color: string;
  peakX: number;
  amplitude: number;
  /** Height of the whole terrain at this ridge's peak, not just this ridge. */
  labelY: number;
  line: string;
  area: string;
}

/** A single ridge's height above the baseline at x. */
function heightAt(peakX: number, amplitude: number, x: number): number {
  return amplitude * Math.exp(-((x - peakX) ** 2) / (2 * SIGMA ** 2));
}

/** The highest point of the whole terrain across a span of the field. */
function terrainMax(
  contributions: CategoryContribution[],
  from: number,
  to: number,
): number {
  let highest = 0;
  for (let x = from; x <= to; x += 8) {
    let here = 0;
    contributions.forEach((contribution, index) => {
      here = Math.max(
        here,
        heightAt(
          peakXFor(index, contributions.length),
          contribution.share * MAX_AMPLITUDE,
          x,
        ),
      );
    });
    highest = Math.max(highest, here);
  }
  return highest;
}

function buildRidges(contributions: CategoryContribution[]): Ridge[] {
  const drawn = contributions;

  return drawn.map((contribution, index) => {
    const peakX = peakXFor(index, drawn.length);
    const amplitude = contribution.share * MAX_AMPLITUDE;

    // A gaussian sampled at a fixed step: deterministic, and smooth enough at
    // this width that no curve fitting is needed.
    const points: string[] = [];
    for (let x = 0; x <= FIELD_WIDTH; x += 10) {
      const y = BASELINE - amplitude * Math.exp(-((x - peakX) ** 2) / (2 * SIGMA ** 2));
      points.push(`${x},${y.toFixed(2)}`);
    }

    return {
      contribution,
      color: scoreColor(contribution.percent),
      peakX,
      amplitude,
      /*
       * Labels clear the terrain, not their own ridge — and they clear it
       * across their own width, not just at their centre. A short ridge under
       * a taller one peaks somewhere on that taller slope, and a centred label
       * measured only at its midpoint still has its left half buried in the
       * curve climbing away behind it.
       */
      labelY: terrainMax(drawn, peakX - LABEL_HALF_WIDTH, peakX + LABEL_HALF_WIDTH),
      line: `M${points.join("L")}`,
      area: `M0,${BASELINE}L${points.join("L")}L${FIELD_WIDTH},${BASELINE}Z`,
    };
  });
}

/** Where a ridge of a given rank peaks, left to right. */
function peakXFor(index: number, count: number): number {
  if (count === 1) return FIELD_WIDTH / 2;
  return MARGIN + (index * (FIELD_WIDTH - MARGIN * 2)) / (count - 1);
}

export default function RiskLandscape({ report }: { report: RiskReport }) {
  const { contributions, unmeasured, totalPoints, sentence, statement } =
    interpretCategories(report.categories);
  const meta = scoreMeta(report.score);
  const { counts } = report.summary;
  const flagged = counts.critical + counts.high + counts.medium + counts.low;

  // Sorted largest-first already, so the landscape descends left to right and
  // the tallest ridge is drawn first — behind the smaller ones.
  const ridges = totalPoints > 0 ? buildRidges(contributions) : [];

  return (
    <Reveal
      as="section"
      id="landscape"
      className={`anchor ${styles.band}`}
      aria-labelledby="what-shaped-this"
      style={{ "--band-tint": meta.soft } as CSSProperties}
    >
      <div className={styles.rule} aria-hidden="true" />

      <div className={styles.intro}>
        <div className="eyebrow">Interpretation</div>
        <div className={styles.mark} aria-hidden="true" />

        <h3 id="what-shaped-this" className={`display ${styles.statement}`}>
          {statement}
        </h3>

        <p className={styles.sentence}>{sentence}</p>
      </div>

      {ridges.length > 0 && (
        <div className={styles.fieldWrap}>
          <div className={styles.field}>
            <svg
              className={styles.svg}
              viewBox={`0 0 ${FIELD_WIDTH} ${FIELD_HEIGHT}`}
              preserveAspectRatio="none"
              aria-hidden="true"
              focusable="false"
            >
              <defs>
                {ridges.map((ridge) => (
                  <linearGradient
                    key={ridge.contribution.category}
                    id={`ridge-${slug(ridge.contribution.category)}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={ridge.color} stopOpacity="0.28" />
                    <stop offset="100%" stopColor={ridge.color} stopOpacity="0.02" />
                  </linearGradient>
                ))}
              </defs>

              {/* Ground plane and the vertical marks each ridge peaks over. */}
              <line
                x1="0"
                y1={BASELINE}
                x2={FIELD_WIDTH}
                y2={BASELINE}
                stroke="var(--line-strong)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              {ridges.map((ridge) => (
                <line
                  key={`tick-${ridge.contribution.category}`}
                  x1={ridge.peakX}
                  y1={BASELINE - ridge.amplitude}
                  x2={ridge.peakX}
                  y2={BASELINE}
                  stroke="rgba(255,255,255,0.07)"
                  strokeWidth="1"
                  strokeDasharray="2 4"
                  vectorEffect="non-scaling-stroke"
                />
              ))}

              {ridges.map((ridge, index) => (
                <g
                  key={ridge.contribution.category}
                  className={styles.ridge}
                  style={{ "--i": index } as CSSProperties}
                >
                  <path
                    className={styles.ridgeArea}
                    d={ridge.area}
                    fill={`url(#ridge-${slug(ridge.contribution.category)})`}
                  />
                  <path
                    className={styles.ridgeLine}
                    d={ridge.line}
                    fill="none"
                    stroke={ridge.color}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    pathLength={1}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ))}
            </svg>

            {/*
              Labels live in HTML rather than in the SVG: the field is stretched
              to fit its container, and text inside a non-uniformly scaled SVG
              stretches with it.
            */}
            {ridges.map((ridge, index) => (
              <div
                key={ridge.contribution.category}
                className={styles.peak}
                style={
                  {
                    left: `${(ridge.peakX / FIELD_WIDTH) * 100}%`,
                    bottom: `${((ridge.labelY + (FIELD_HEIGHT - BASELINE)) / FIELD_HEIGHT) * 100}%`,
                    "--i": index,
                    "--peak-color": ridge.color,
                  } as CSSProperties
                }
              >
                <span className={`tnum ${styles.peakValue}`}>
                  {ridge.contribution.sharePercent}%
                </span>
                <span className={styles.peakName}>{ridge.contribution.category}</span>
              </div>
            ))}
          </div>

          <p className={styles.legend}>
            Ridge height is each category&rsquo;s share of the risk charged · colour is how
            intense that category was
          </p>
        </div>
      )}

      <ul className={styles.lanes}>
        {contributions.map((contribution) => {
          const color = scoreColor(contribution.percent);
          return (
            <li key={contribution.category} className={styles.lane}>
              <div className={styles.laneTop}>
                <span className={styles.dot} aria-hidden="true" style={{ background: color }} />
                <span className={styles.laneName}>{contribution.category}</span>
              </div>
              <div className={`tnum ${styles.laneValue}`} style={{ color }}>
                {contribution.sharePercent}%
              </div>
              <div className={styles.laneNote}>
                {contribution.points === 0 ? "nothing charged" : "of charged risk"}
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
            <div className={`tnum ${styles.laneValue}`} style={{ color: "var(--ink-faint)" }}>
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
        <Stat
          value={String(flagged)}
          label={flagged === 1 ? "flagged signal" : "flagged signals"}
        />
        <Stat value={String(counts.none)} label="with no concern" />
      </div>

      <div className={styles.rule} aria-hidden="true" />
    </Reveal>
  );
}

function Stat({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div className={styles.stat}>
      <span className={`tnum ${styles.statValue}`} style={color ? { color } : undefined}>
        {value}
      </span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function slug(category: string): string {
  return category.toLowerCase().replace(/[^a-z]+/g, "-");
}
