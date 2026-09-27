"use client";

import { useMemo, useRef, useState } from "react";

import type { PricePoint } from "@/lib/providers/geckoterminal";
import type { RiskReport } from "@/lib/risk-engine/types";
import { formatPrice } from "@/lib/format";

import styles from "./MarketContextChart.module.css";

/** History has already been checked on the server before scoring. */
export default function MarketContextChart({ report }: { report: RiskReport }) {
  const { history, historyStatus, historyReason, poolDex } = report.market;
  const ready = history?.available && historyStatus === "consistent";
  return (
    <section className={styles.panel} aria-label="4 hour market context">
      <header className={styles.head}>
        <div><div className="eyebrow">4H market context</div>
          {ready && <Change points={history.points} />}
        </div>
        {ready && poolDex && <span className={styles.source}>via {poolDex}</span>}
      </header>
      {ready ? <Plot points={history.points} /> : (
        <div className={styles.placeholder}>
          <span className={styles.absentTitle}>{historyStatus === "conflict" || report.market.status === "conflict" ? "Market data conflict" : "4H price history unavailable"}</span>
          <span className={styles.absentReason}>{report.market.status === "conflict" ? report.market.reason : historyReason}</span>
        </div>
      )}
      <p className={styles.caption}>Market context · contradictions affect data validation; the four-hour return is not scored.</p>
    </section>
  );
}

function Change({ points }: { points: PricePoint[] }) {
  const first = points[0].p;
  const last = points[points.length - 1].p;
  if (!(first > 0)) return null;

  const percent = ((last - first) / first) * 100;
  const glyph = percent > 0 ? "▲" : percent < 0 ? "▼" : "·";

  return (
    <div className={`tnum ${styles.headline}`}>
      <span className={styles.price}>{formatPrice(last)}</span>
      {/*
        Neutral ink, like the 24h figure in the rail: the severity ramp is
        reserved for risk in this product, and a token being down this
        afternoon is not a risk signal.
      */}
      <span className={styles.change}>
        {glyph} {percent > 0 ? "+" : ""}
        {percent.toFixed(2)}% · 4h
      </span>
    </div>
  );
}

const VIEW_W = 600;
const VIEW_H = 190;
const PAD_Y = 14;

function Plot({ points }: { points: PricePoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);

  const geometry = useMemo(() => {
    const prices = points.map((point) => point.p);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    // A perfectly flat series would divide by zero; give it a nominal band so
    // it draws as a level line through the middle rather than at an edge.
    const span = max - min || max * 0.02 || 1;
    const t0 = points[0].t;
    const tSpan = points[points.length - 1].t - t0 || 1;

    const x = (t: number) => ((t - t0) / tSpan) * VIEW_W;
    const y = (p: number) => VIEW_H - PAD_Y - ((p - min) / span) * (VIEW_H - PAD_Y * 2);

    const coords = points.map((point) => ({ x: x(point.t), y: y(point.p), ...point }));
    const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join("");
    const area = `${line}L${VIEW_W},${VIEW_H}L0,${VIEW_H}Z`;

    return { coords, line, area, min, max };
  }, [points]);

  const active = hover === null ? null : geometry.coords[hover];

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = ref.current;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    const target = ratio * VIEW_W;

    // Nearest point by x, so the readout tracks the cursor exactly.
    let best = 0;
    let bestGap = Infinity;
    geometry.coords.forEach((coord, index) => {
      const gap = Math.abs(coord.x - target);
      if (gap < bestGap) {
        bestGap = gap;
        best = index;
      }
    });
    setHover(best);
  };

  return (
    <div className={styles.plot}>
      <svg
        ref={ref}
        className={styles.svg}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Price over the last four hours, ${points.length} observations, from ${formatPrice(geometry.min)} to ${formatPrice(geometry.max)}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="mc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.20" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/*
          A transparent hit surface. Inline SVG only hit-tests painted
          geometry, so without this the pointer finds nothing over the empty
          parts of the plot and the readout never moves.
        */}
        <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="transparent" />

        {/* Three reference lines — enough to read level by, not a grid. */}
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1="0"
            x2={VIEW_W}
            y1={PAD_Y + fraction * (VIEW_H - PAD_Y * 2)}
            y2={PAD_Y + fraction * (VIEW_H - PAD_Y * 2)}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <path d={geometry.area} fill="url(#mc-fill)" />
        <path
          className={styles.line}
          d={geometry.line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.75"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {active && (
          <>
            <line
              x1={active.x}
              x2={active.x}
              y1={0}
              y2={VIEW_H}
              stroke="rgba(255,255,255,0.18)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={active.x} cy={active.y} r="3" fill="var(--accent)" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>

      {/*
        The readout is HTML rather than SVG text: the plot is stretched to fit
        its column, and text inside a non-uniformly scaled SVG stretches with
        it.
      */}
      <div className={styles.readout} aria-hidden="true">
        {active ? (
          <>
            <span className={`tnum ${styles.readoutPrice}`}>{formatPrice(active.p)}</span>
            <span className={`tnum ${styles.readoutTime}`}>
              {new Date(active.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </>
        ) : (
          <span className={`tnum ${styles.readoutTime}`}>
            {points.length} observations · 5-minute closes
          </span>
        )}
      </div>
    </div>
  );
}
