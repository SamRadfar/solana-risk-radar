"use client";

import { useId, useState } from "react";

import type { RiskSignal } from "@/lib/risk-engine/types";
import { SEVERITY_META, UNAVAILABLE_META } from "@/lib/severity";

import Reveal from "./Reveal";
import styles from "./SignalLedger.module.css";

/**
 * Findings as a ledger rather than a grid of cards.
 *
 * Every finding still states what was measured, what was found, how much it
 * contributed, how severe that is and why — that mapping is the product's core
 * claim and none of it is dropped here. What changes is the container: a row
 * separated by a hairline and marked by a severity rail, instead of one more
 * rounded rectangle in a wall of them.
 *
 * Rows are not uniform. A critical finding carries a brighter rail, a filled
 * severity mark, a larger label and a tinted wash; a low one is deliberately
 * quiet. Reading the page from top to bottom should feel like reading a ledger
 * where the serious entries stand out, not a grid where everything shouts
 * equally.
 */

/** How much visual weight a row gets, derived only from its severity. */
function weightOf(signal: RiskSignal): "strong" | "normal" | "quiet" | "muted" {
  if (signal.status === "unavailable") return "muted";
  if (signal.severity === "critical" || signal.severity === "high") return "strong";
  if (signal.severity === "medium") return "normal";
  return "quiet";
}

export default function SignalLedger({ signals }: { signals: RiskSignal[] }) {
  return (
    <Reveal as="ol" stagger step={45} className={styles.ledger}>
      {signals.map((signal) => (
        <LedgerRow key={signal.id} signal={signal} />
      ))}
    </Reveal>
  );
}

function LedgerRow({ signal }: { signal: RiskSignal }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const unavailable = signal.status === "unavailable";
  const meta = unavailable ? UNAVAILABLE_META : SEVERITY_META[signal.severity];
  const hasEvidence = signal.evidence.length > 0;
  const charged = signal.maxPoints > 0 ? signal.points / signal.maxPoints : 0;
  const weight = weightOf(signal);

  return (
    <li className={styles.row} data-weight={weight} data-open={open ? "true" : "false"}>
      {/* Severity rail — a redundant, non-textual channel for the level. */}
      <span
        aria-hidden="true"
        className={styles.rail}
        style={{
          background: unavailable
            ? "var(--line-strong)"
            : `linear-gradient(180deg, ${meta.color} 0%, ${meta.color}33 100%)`,
        }}
      />

      <div className={styles.grid}>
        {/* Colour, glyph and word together — severity never relies on hue. */}
        <div className={styles.severity}>
          <span
            className={styles.badge}
            style={{
              color: meta.color,
              background: weight === "strong" ? meta.bg : "transparent",
              borderColor: weight === "quiet" || weight === "muted" ? "var(--line)" : meta.border,
            }}
          >
            <span aria-hidden="true" className={styles.glyph}>
              {meta.glyph}
            </span>
            {meta.label}
          </span>
        </div>

        <div className={styles.identity}>
          <h4 className={styles.name}>{signal.label}</h4>
          <p className={styles.metric}>{signal.metric}</p>
        </div>

        <div className={styles.observed}>
          <span
            className={`font-mono ${styles.observedValue}`}
            style={{ color: unavailable ? "var(--ink-muted)" : meta.color }}
          >
            {signal.observedValue}
          </span>
        </div>

        <div className={styles.contribution}>
          <span className={`tnum ${styles.points}`}>
            {unavailable ? (
              <span className={styles.excluded}>excluded</span>
            ) : (
              <>
                <span style={{ color: signal.points > 0 ? meta.color : "var(--ink-secondary)" }}>
                  {signal.points}
                </span>
                <span className={styles.outOf}>/{signal.maxPoints}</span>
              </>
            )}
          </span>
          {/* Contribution rendered as length as well as a number. */}
          <span className={styles.bar} aria-hidden="true">
            {!unavailable && charged > 0 && (
              <span
                className={styles.barFill}
                style={
                  {
                    "--fill": Math.max(charged, 0.03),
                    background: meta.color,
                  } as React.CSSProperties
                }
              />
            )}
          </span>
          <span className={styles.pointsLabel}>
            {unavailable ? `weight ${signal.maxPoints}` : "pts charged"}
          </span>
        </div>

        <p className={styles.explanation}>{signal.explanation}</p>

        {hasEvidence && (
          <div className={styles.action}>
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls={panelId}
              className={styles.trigger}
              style={{ color: open ? "var(--ink-secondary)" : "var(--accent)" }}
            >
              {/*
                An unavailable signal's evidence describes why the measurement
                failed, not a finding. Labelling it "Inspect evidence" would
                imply a measurement exists when it does not.
              */}
              {open ? "Hide details" : unavailable ? "Why not measured" : "Inspect evidence"}
              <span aria-hidden="true" className={styles.chevron}>
                ↓
              </span>
            </button>
          </div>
        )}
      </div>

      {open && hasEvidence && (
        <div id={panelId} className={styles.panel}>
          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 10 }}>
            {unavailable ? "Why this could not be measured" : "Supporting evidence"}
          </div>
          <dl className={styles.evidence}>
            {signal.evidence.map((item, index) => (
              <div key={`${item.label}-${index}`} className={styles.evidenceRow}>
                <dt className={styles.evidenceLabel}>{item.label}</dt>
                <dd className={`font-mono ${styles.evidenceValue}`}>
                  {item.href ? (
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.evidenceLink}
                    >
                      {item.value}
                    </a>
                  ) : (
                    item.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </li>
  );
}
