import type { RiskReport, RiskSignal } from "@/lib/risk-engine/types";
import { RISK_CATEGORIES } from "@/lib/risk-engine/types";

import QuickAssessment from "./QuickAssessment";
import CategoryProfile from "./CategoryProfile";
import DistributionPanel from "./DistributionPanel";
import SignalCard from "./SignalCard";

/**
 * The full report, in two deliberate layers.
 *
 * **Quick assessment** answers the question on its own: score, band, why, how
 * many findings at each severity, and the three that mattered most.
 *
 * **Detailed evidence** is everything behind that answer — the category
 * breakdown, every signal with its raw evidence, the classified holder table
 * and the data provenance. Nothing is removed or summarised away; it is placed
 * after the answer rather than in front of it.
 */
export default function ReportView({ report }: { report: RiskReport }) {
  const measured = report.signals.filter((s) => s.status === "ok");
  const flagged = measured
    .filter((s) => s.severity !== "none")
    .sort((a, b) => b.points - a.points);
  const passed = measured.filter((s) => s.severity === "none");
  const unmeasured = report.signals.filter((s) => s.status === "unavailable");

  return (
    <div className="animate-fade-in-up space-y-5">
      <QuickAssessment report={report} />

      {report.warnings.length > 0 && (
        <div
          className="rounded-xl border p-4 text-sm leading-relaxed space-y-2"
          style={{
            borderColor: "rgba(250,178,25,0.35)",
            background: "rgba(250,178,25,0.07)",
            color: "#fab219",
          }}
        >
          {report.warnings.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
        </div>
      )}

      {/* ---- Layer 2: everything behind the answer ---- */}
      <div className="pt-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold">Detailed evidence</h2>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Every signal, its exact contribution, and the data behind it
          </p>
        </div>
        <div className="mt-2 h-px" style={{ background: "var(--border)" }} />
      </div>

      <CategoryProfile categories={report.categories} />

      {flagged.length > 0 && (
        <SignalGroup
          title="Flagged signals"
          caption="Ordered by how much each contributed to the score"
          signals={flagged}
        />
      )}

      {passed.length > 0 && (
        <SignalGroup
          title="Signals with no concern"
          caption="Checked and found clean"
          signals={sortByCategory(passed)}
        />
      )}

      <DistributionPanel distribution={report.distribution} />

      {unmeasured.length > 0 && (
        <SignalGroup
          title="Could not be measured"
          caption="Excluded from the score rather than guessed at"
          signals={unmeasured}
        />
      )}

      {/* Provenance */}
      <section
        className="rounded-2xl border p-5 sm:p-6"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <h3 className="text-sm font-semibold">Data sources</h3>
        <ul className="mt-3 space-y-2">
          {report.sources.map((source) => (
            <li key={source.name} className="flex items-start gap-2.5 text-xs">
              <span
                aria-hidden="true"
                className="mt-1 h-1.5 w-1.5 rounded-full shrink-0"
                style={{ background: source.ok ? "#22c55e" : "var(--muted)" }}
              />
              <span>
                <span style={{ color: "var(--foreground)" }}>{source.name}</span>
                <span style={{ color: "var(--muted)" }}> — {source.detail}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs tnum" style={{ color: "var(--muted)" }}>
          Generated {new Date(report.generatedAt).toLocaleString()} · analysed in{" "}
          {(report.elapsedMs / 1000).toFixed(1)}s · {report.availableWeight} of{" "}
          {report.totalWeight} signal weight measurable
        </p>
      </section>

      <p
        className="rounded-xl border p-4 text-sm leading-relaxed"
        style={{
          borderColor: "var(--border)",
          background: "var(--surface)",
          color: "var(--muted-strong)",
        }}
      >
        <strong style={{ color: "var(--foreground)" }}>Not financial advice.</strong> Risk
        Radar is a risk-signal analyser: it reports what is measurable on chain and in market
        data, and nothing else. It is not a scam detector, a safety guarantee, or a prediction
        of price. A clean report is not a guarantee, and a flagged one is not an accusation —
        many legitimate tokens deliberately retain authorities or are newly launched. Risks
        that are invisible here include off-chain promises, team intent, and logic in other
        programs. Every figure shown is either measured or explicitly marked as not measured.
        Always do your own research.
      </p>
    </div>
  );
}

function SignalGroup({
  title,
  caption,
  signals,
}: {
  title: string;
  caption: string;
  signals: RiskSignal[];
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {caption}
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {signals.map((signal) => (
          <SignalCard key={signal.id} signal={signal} />
        ))}
      </div>
    </section>
  );
}

function sortByCategory(signals: RiskSignal[]): RiskSignal[] {
  return [...signals].sort(
    (a, b) => RISK_CATEGORIES.indexOf(a.category) - RISK_CATEGORIES.indexOf(b.category),
  );
}
