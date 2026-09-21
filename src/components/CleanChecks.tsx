"use client";

import { useId, useState } from "react";

import type { RiskSignal } from "@/lib/risk-engine/types";
import { SEVERITY_META } from "@/lib/severity";

import Reveal from "./Reveal";
import styles from "./CleanChecks.module.css";

/**
 * Signals that came back clean.
 *
 * A clean check does not deserve the same visual weight as a finding. These
 * used to be full cards with an explanation each, which meant nine paragraphs
 * arguing that nothing was wrong — the section shouted louder the safer the
 * token was.
 *
 * Now each is one compact row: the check, its observed value, a green mark.
 * The explanation and the raw evidence are still there, one click away, so
 * nothing is hidden — only deferred until a reader asks for it.
 */
export default function CleanChecks({ signals }: { signals: RiskSignal[] }) {
  return (
    <Reveal as="ul" stagger step={35} className={styles.grid}>
      {signals.map((signal) => (
        <CheckRow key={signal.id} signal={signal} />
      ))}
    </Reveal>
  );
}

function CheckRow({ signal }: { signal: RiskSignal }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const meta = SEVERITY_META.none;
  const hasEvidence = signal.evidence.length > 0;

  return (
    <li className={styles.item} data-open={open ? "true" : "false"}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={hasEvidence ? panelId : undefined}
        /*
         * The accessible name opens with the visible label, so the control
         * satisfies label-in-name, and still contains the phrase the rest of
         * the product uses for this action.
         */
        aria-label={`${signal.label} — inspect evidence`}
        className={styles.row}
      >
        <span className={styles.check} aria-hidden="true" style={{ color: meta.color }}>
          {meta.glyph}
        </span>

        <span className={styles.label}>{signal.label}</span>

        <span className={`font-mono ${styles.value}`}>{signal.observedValue}</span>

        <span aria-hidden="true" className={styles.chevron}>
          ↓
        </span>
      </button>

      {open && (
        <div id={panelId} className={styles.panel}>
          <p className={styles.explanation}>{signal.explanation}</p>

          <div className={styles.meta}>
            <span>{signal.metric}</span>
            <span className={styles.dot} aria-hidden="true" />
            <span className="tnum">
              0 / {signal.maxPoints} pts charged
            </span>
          </div>

          {hasEvidence && (
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
          )}
        </div>
      )}
    </li>
  );
}
