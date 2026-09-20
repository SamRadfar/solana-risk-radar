"use client";

import { useState } from "react";
import type { RiskSignal } from "@/lib/risk-engine/types";
import { SEVERITY_META } from "@/lib/severity";

export default function SignalCard({ signal }: { signal: RiskSignal }) {
  const [open, setOpen] = useState(false);
  const meta = SEVERITY_META[signal.severity];
  const evidenceEntries = Object.entries(signal.evidence ?? {});
  const isUnavailable = signal.status === "unavailable";

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <button
        type="button"
        onClick={() => evidenceEntries.length > 0 && setOpen((o) => !o)}
        className="w-full text-left p-4 flex items-start gap-3 cursor-pointer"
      >
        <div
          className="mt-0.5 h-2.5 w-2.5 rounded-full shrink-0"
          style={{ background: isUnavailable ? "#3a3f4c" : meta.color }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="font-medium text-[15px]">{signal.label}</h3>
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
              style={{
                color: isUnavailable ? "var(--muted)" : meta.color,
                background: isUnavailable ? "var(--surface-2)" : meta.bg,
              }}
            >
              {isUnavailable ? "Unavailable" : meta.label}
            </span>
          </div>
          <p className="text-sm mt-1 font-mono break-all" style={{ color: "var(--muted)" }}>
            {signal.observedValue}
          </p>
          <p className="text-sm mt-2 leading-relaxed" style={{ color: "var(--foreground)", opacity: 0.85 }}>
            {signal.explanation}
          </p>
          <div className="mt-2 flex items-center gap-3 text-xs" style={{ color: "var(--muted)" }}>
            <span>
              Contribution: {signal.points}/{signal.maxPoints} pts
            </span>
            {evidenceEntries.length > 0 && (
              <span style={{ color: "var(--accent-dim)" }}>{open ? "Hide evidence ▲" : "Inspect evidence ▼"}</span>
            )}
          </div>
        </div>
      </button>
      {open && evidenceEntries.length > 0 && (
        <div className="px-4 pb-4">
          <div
            className="rounded-lg p-3 text-xs font-mono overflow-x-auto"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
          >
            {evidenceEntries.map(([key, val]) => (
              <div key={key} className="flex gap-2 py-0.5">
                <span style={{ color: "var(--muted)" }}>{key}:</span>
                <span className="break-all">{formatEvidenceValue(val)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatEvidenceValue(val: unknown): string {
  if (val === null) return "null";
  if (typeof val === "number") return val.toString();
  if (Array.isArray(val)) return JSON.stringify(val);
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}
