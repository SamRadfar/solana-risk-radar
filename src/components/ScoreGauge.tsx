import { scoreColor } from "@/lib/severity";

interface Props {
  score: number | null;
  size?: number;
}

/**
 * The headline figure: a single ratio against a fixed limit (0-100), so it is
 * drawn as a radial meter with the hero number inside it.
 *
 * The number is the primary channel and is legible on its own; the arc and its
 * colour are reinforcement, never the only way to read the result.
 */
export default function ScoreGauge({ score, size = 168 }: Props) {
  const stroke = 12;
  const radius = (size - stroke - 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = score === null ? 0 : Math.max(0, Math.min(100, score));
  const offset = circumference * (1 - clamped / 100);
  const color = score === null ? "var(--muted)" : scoreColor(score);

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={
        score === null
          ? "Risk score unavailable: not enough data could be measured"
          : `Risk score ${score} out of 100`
      }
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--surface-3)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{
              transition:
                "stroke-dashoffset 0.9s cubic-bezier(0.16,1,0.3,1), stroke 0.4s ease",
            }}
          />
        </g>
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="tnum font-semibold leading-none"
          style={{ fontSize: 52, color }}
        >
          {score === null ? "—" : score}
        </span>
        <span
          className="text-[11px] uppercase tracking-[0.14em] mt-2"
          style={{ color: "var(--muted)" }}
        >
          {score === null ? "no score" : "risk / 100"}
        </span>
      </div>
    </div>
  );
}
