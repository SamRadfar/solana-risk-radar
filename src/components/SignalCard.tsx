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
  const charged = signal.maxPoints > 0 ? signal.points / signal.maxPoints : 0;

  return (
    <article
      className="card card-hover overflow-hidden flex flex-col"
      style={{ borderColor: open ? meta.border : undefined }}
    >
      {/* Severity rail — redundant, non-textual channel for the level. */}
      <div
        aria-hidden="true"
        className="absolute left-0 top-0 bottom-0 w-[2px]"
        style={{
          background: unavailable
            ? "var(--line-strong)"
            : `linear-gradient(180deg, ${meta.color} 0%, transparent 92%)`,
        }}
      />

      <div className="p-4 pl-5 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="font-medium text-[15px] leading-tight">{signal.label}</h4>
            <p className="text-[11px] mt-1" style={{ color: "var(--ink-muted)" }}>
              {signal.metric}
            </p>
          </div>

          {/* Colour, glyph and word together — severity never relies on hue. */}
          <span
            className="text-[11px] font-medium px-2 py-1 rounded-full shrink-0 flex items-center gap-1.5 whitespace-nowrap"
            style={{ color: meta.color, background: meta.bg, border: `1px solid ${meta.border}` }}
          >
            <span aria-hidden="true" className="text-[9px] leading-none">
              {meta.glyph}
            </span>
            {meta.label}
          </span>
        </div>

        <p
          className="text-sm mt-3 font-mono break-words"
          style={{ color: unavailable ? "var(--ink-muted)" : "var(--ink)" }}
        >
          {signal.observedValue}
        </p>

        <p className="text-[13px] mt-2.5 leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
          {signal.explanation}
        </p>
      </div>

      <div
        className="px-4 pl-5 py-3 flex items-center justify-between gap-3"
        style={{ borderTop: "1px solid var(--line)", background: "rgba(0,0,0,0.18)" }}
      >
        <div className="min-w-0">
          <div className="tnum text-[11px]" style={{ color: "var(--ink-muted)" }}>
            {unavailable ? (
              <>Excluded from score · weight {signal.maxPoints}</>
            ) : (
              <>
                <span style={{ color: signal.points > 0 ? meta.color : "var(--ink-secondary)" }}>
                  {signal.points}
                </span>
                {" / "}
                {signal.maxPoints} pts contributed
              </>
            )}
          </div>
          {/* Contribution rendered as length as well as a number. */}
          <div
            className="mt-1.5 h-[3px] w-24 rounded-full overflow-hidden"
            style={{ background: "rgba(255,255,255,0.07)" }}
            aria-hidden="true"
          >
            {!unavailable && charged > 0 && (
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(charged * 100, 3)}%`,
                  background: meta.color,
                  transition: "width 0.9s cubic-bezier(0.16,1,0.3,1)",
                }}
              />
            )}
          </div>
        </div>

        {hasEvidence && (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={panelId}
            className="cursor-pointer font-medium text-[12px] shrink-0 transition-colors"
            style={{ color: open ? "var(--ink-secondary)" : "var(--accent)" }}
          >
            {/*
              An unavailable signal's evidence describes why the measurement
              failed, not a finding. Labelling it "Inspect evidence" would imply
              a measurement exists when it does not.
            */}
            {open ? "Hide details" : unavailable ? "Why not measured" : "Inspect evidence"}
          </button>
        )}
      </div>

      {open && hasEvidence && (
        <div
          id={panelId}
          className="px-4 pl-5 pb-4 pt-3.5"
          style={{ background: "rgba(0,0,0,0.28)", borderTop: "1px solid var(--line)" }}
        >
          <div className="eyebrow mb-2.5" style={{ fontSize: 10 }}>
            {unavailable ? "Why this could not be measured" : "Supporting evidence"}
          </div>
          <dl className="space-y-2">
            {signal.evidence.map((item, index) => (
              <div
                key={`${item.label}-${index}`}
                className="grid grid-cols-1 sm:grid-cols-[minmax(0,10.5rem)_1fr] gap-x-3 gap-y-0.5 text-[12px] items-baseline"
              >
                <dt style={{ color: "var(--ink-muted)" }} className="truncate">
                  {item.label}
                </dt>
                <dd className="font-mono break-all">
                  {item.href ? (
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-dotted underline-offset-2 transition-colors"
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
