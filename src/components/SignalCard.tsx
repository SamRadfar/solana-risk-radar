"use client";

import { useId, useState } from "react";

import type { RiskSignal } from "@/lib/risk-engine/types";
import { SEVERITY_META, UNAVAILABLE_META } from "@/lib/severity";

/**
 * One risk rule's result.
 *
 * Every card states what was measured (metric), what was found (observed
 * value), how much it contributed (points), how severe that is (severity), and
 * why (explanation) — then opens to the raw evidence behind it. That mapping is
 * the product's core claim: nothing in the score is unexplained.
 */
export default function SignalCard({ signal }: { signal: RiskSignal }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const unavailable = signal.status === "unavailable";
  const meta = unavailable ? UNAVAILABLE_META : SEVERITY_META[signal.severity];
  const hasEvidence = signal.evidence.length > 0;

  return (
    <article
      className="rounded-xl border overflow-hidden flex flex-col"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="p-4 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="font-medium text-[15px] leading-tight">{signal.label}</h4>
            <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
              {signal.metric}
            </p>
          </div>

          {/* Colour, glyph and word together — severity never relies on hue. */}
          <span
            className="text-xs font-medium px-2 py-1 rounded-full shrink-0 border flex items-center gap-1.5 whitespace-nowrap"
            style={{ color: meta.color, background: meta.bg, borderColor: meta.border }}
          >
            <span aria-hidden="true" className="text-[10px] leading-none">
              {meta.glyph}
            </span>
            {meta.label}
          </span>
        </div>

        <p className="text-sm mt-3 font-mono break-words" style={{ color: "var(--foreground)" }}>
          {signal.observedValue}
        </p>

        <p
          className="text-sm mt-2 leading-relaxed"
          style={{ color: "var(--muted-strong)" }}
        >
          {signal.explanation}
        </p>
      </div>

      <div
        className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs border-t"
        style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
      >
        <span className="tnum" style={{ color: "var(--muted)" }}>
          {unavailable ? (
            <>Excluded from score · weight {signal.maxPoints}</>
          ) : (
            <>
              Contributed{" "}
              <span style={{ color: signal.points > 0 ? meta.color : "var(--muted-strong)" }}>
                {signal.points}
              </span>{" "}
              of {signal.maxPoints} pts
            </>
          )}
        </span>

        {hasEvidence && (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={panelId}
            className="cursor-pointer font-medium"
            style={{ color: "var(--accent-dim)" }}
          >
            {open ? "Hide evidence" : "Inspect evidence"}
          </button>
        )}
      </div>

      {open && hasEvidence && (
        <div id={panelId} className="px-4 pb-4 pt-3" style={{ background: "var(--surface-2)" }}>
          <dl className="space-y-1.5">
            {signal.evidence.map((item, index) => (
              <div
                key={`${item.label}-${index}`}
                className="grid grid-cols-1 sm:grid-cols-[minmax(0,11rem)_1fr] gap-x-3 gap-y-0.5 text-xs items-baseline"
              >
                <dt style={{ color: "var(--muted)" }} className="truncate">
                  {item.label}
                </dt>
                <dd className="font-mono break-all" style={{ color: "var(--foreground)" }}>
                  {item.href ? (
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-dotted underline-offset-2"
                      style={{ color: "var(--accent)" }}
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
    </article>
  );
}
