"use client";

import { useId, useState } from "react";

import type { RiskReport } from "@/lib/risk-engine/types";

import Reveal from "./Reveal";
import styles from "./SourceStrip.module.css";

/**
 * Provenance, as a strip rather than a panel.
 *
 * Where the data came from matters — it is the difference between a number a
 * reader can check and one they have to trust — but it is reference material,
 * not an argument, and it was being given a full card at the end of the page
 * as though it were another finding.
 *
 * The strip states each source and whether it answered. The detail behind each
 * one is a click away, and the run's own metadata sits on a single line
 * beneath. The section is deliberately the quietest on the page.
 */
export default function SourceStrip({ report }: { report: RiskReport }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const failed = report.sources.filter((source) => !source.ok).length;

  return (
    <section id="sources" className="anchor">
      <Reveal className={styles.strip}>
        <div className={styles.head}>
          <div>
            <div className="eyebrow">Provenance</div>
            <h3 className={styles.title}>Data sources</h3>
          </div>

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={panelId}
            className={styles.toggle}
          >
            {open ? "Hide details" : "What each source returned"}
            <span aria-hidden="true" className={styles.chevron}>
              ↓
            </span>
          </button>
        </div>

        <ul className={styles.sources}>
          {report.sources.map((source) => (
            <li key={source.name} className={styles.source} data-ok={source.ok ? "true" : "false"}>
              <span
                aria-hidden="true"
                className={styles.dot}
                style={{
                  background: source.ok ? "var(--sev-none, #22c55e)" : "var(--ink-faint)",
                  boxShadow: source.ok ? "0 0 8px rgba(34,197,94,0.45)" : "none",
                }}
              />
              <span className={styles.sourceName}>{source.name}</span>
              <span className={styles.sourceState}>{source.ok ? "ok" : "no data"}</span>
            </li>
          ))}
        </ul>

        {open && (
          <dl id={panelId} className={styles.details}>
            {report.sources.map((source) => (
              <div key={source.name} className={styles.detailRow}>
                <dt className={styles.detailName}>{source.name}</dt>
                <dd className={styles.detailValue}>{source.detail}</dd>
              </div>
            ))}
          </dl>
        )}

        <p className={`tnum ${styles.meta}`}>
          Analysed in {(report.elapsedMs / 1000).toFixed(1)}s · {report.availableWeight} of{" "}
          {report.totalWeight} signal weight measurable · {report.coveragePercent}% coverage
          {failed > 0 && ` · ${failed} source${failed === 1 ? "" : "s"} returned nothing`}
          {" · "}
          {new Date(report.generatedAt).toLocaleString()}
        </p>
      </Reveal>
    </section>
  );
}
