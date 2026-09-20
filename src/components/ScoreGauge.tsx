import { scoreColor } from "@/lib/severity";

interface Props {
  score: number | null;
  size?: number;
}

export default function ScoreGauge({ score, size = 148 }: Props) {
  const radius = (size - 14) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score));
  const offset = circumference * (1 - pct / 100);
  const color = score === null ? "#3a3f4c" : scoreColor(score);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border)" strokeWidth={10} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.16,1,0.3,1), stroke 0.4s" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-semibold font-mono-num" style={{ color: score === null ? "var(--muted)" : color }}>
          {score === null ? "—" : score}
        </span>
        <span className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
          {score === null ? "no score" : "/ 100"}
        </span>
      </div>
    </div>
  );
}
