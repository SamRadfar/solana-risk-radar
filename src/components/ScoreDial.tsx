import type { RiskClassification } from "@/lib/risk-engine/types";
import { CLASSIFICATION_SHORT, scoreMeta } from "@/lib/severity";

interface Props {
  score: number | null;
  classification: RiskClassification;
  size?: number;
  /** Compact variant drops the ticks and shrinks the type. */
  compact?: boolean;
}

/**
 * The headline figure: a 270° instrument dial.
 *
 * A single ratio against a fixed limit, so it is drawn as a meter with the
 * number as the primary channel — the dial and its colour reinforce, they never
 * carry the reading alone. Graduated ticks give it the feel of a measuring
 * instrument rather than a progress bar, which is the product's whole posture.
 */
export default function ScoreDial({
  score,
  classification,
  size = 200,
  compact = false,
}: Props) {
  const meta = scoreMeta(score);
  const stroke = compact ? 9 : 12;
  const radius = (size - stroke) / 2 - (compact ? 2 : 10);
  const cx = size / 2;
  const cy = size / 2;

  const circumference = 2 * Math.PI * radius;
  // A 270° sweep leaves a 90° gap at the bottom — the classic gauge opening.
  const SWEEP = 0.75;
  const arcLength = circumference * SWEEP;
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;

  // SVG circles start at 3 o'clock; rotating 135° puts the arc's start at the
  // lower-left, so the gap sits symmetrically at the bottom.
  const rotation = `rotate(135 ${cx} ${cy})`;

  const ticks = compact
    ? []
    : Array.from({ length: 11 }, (_, i) => {
        const value = i * 10;
        const angle = ((225 + (value / 100) * 270) * Math.PI) / 180;
        const outer = radius + stroke / 2 + 6;
        const inner = outer - (value % 50 === 0 ? 7 : 4);
        return {
          value,
          x1: cx + Math.sin(angle) * inner,
          y1: cy - Math.cos(angle) * inner,
          x2: cx + Math.sin(angle) * outer,
          y2: cy - Math.cos(angle) * outer,
          major: value % 50 === 0,
          lit: score !== null && value <= score,
        };
      });

  const gradientId = `dial-${compact ? "c" : "f"}`;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={
        score === null
          ? "Risk score unavailable: not enough data could be measured"
          : `Risk score ${score} out of 100 — ${classification}`
      }
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={meta.color} stopOpacity="0.55" />
            <stop offset="100%" stopColor={meta.color} stopOpacity="1" />
          </linearGradient>
        </defs>

        {ticks.map((tick) => (
          <line
            key={tick.value}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            stroke={tick.lit ? meta.color : "rgba(255,255,255,0.16)"}
            strokeOpacity={tick.lit ? 0.7 : tick.major ? 1 : 0.55}
            strokeWidth={tick.major ? 1.6 : 1}
            strokeLinecap="round"
          />
        ))}

        {/* Track */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${arcLength} ${circumference}`}
          transform={rotation}
        />

        {/* Reading */}
        {score !== null && (
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arcLength * pct} ${circumference}`}
            transform={rotation}
            style={{
              filter: `drop-shadow(0 0 ${compact ? 5 : 9}px ${meta.glow})`,
              transition:
                "stroke-dasharray 1s cubic-bezier(0.16,1,0.3,1), stroke 0.4s ease",
            }}
          />
        )}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="tnum font-semibold display"
          style={{
            fontSize: compact ? size * 0.3 : size * 0.31,
            color: score === null ? "var(--ink-muted)" : meta.color,
            textShadow: score === null ? "none" : `0 0 28px ${meta.glow}`,
          }}
        >
          {score === null ? "—" : score}
        </span>

        {compact ? (
          <span className="eyebrow mt-1" style={{ fontSize: 9 }}>
            {CLASSIFICATION_SHORT[classification]}
          </span>
        ) : (
          <>
            <span
              className="tnum mt-0.5"
              style={{ fontSize: 12, color: "var(--ink-faint)" }}
            >
              / 100
            </span>
            <span className="eyebrow mt-2">Risk score</span>
          </>
        )}
      </div>
    </div>
  );
}
