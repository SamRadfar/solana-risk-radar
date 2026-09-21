import type { RiskReport, RiskSignal } from "@/lib/risk-engine/types";
import { RISK_CATEGORIES } from "@/lib/risk-engine/types";

import VerdictHero from "./VerdictHero";
import SummaryRail from "./SummaryRail";
import CategoryProfile from "./CategoryProfile";
import DistributionPanel from "./DistributionPanel";
import InterpretationBand from "./InterpretationBand";
import Reveal from "./Reveal";
import SignalCard from "./SignalCard";

/**
 * The full report, in two deliberate layers and — on wide screens — two columns.
 *
 * **The verdict hero** spans the full width and answers the question on its
 * own: score, band, why, how many findings at each severity, and the three that
 * mattered most.
 *
 * **Detailed evidence** sits below in an asymmetric split. The wide main column
 * carries the argument (category profile, every signal with its raw evidence,
 * the classified holder table, provenance). The sticky rail carries persistent
 * context — a condensed verdict, the findings tally, key market numbers and
 * section navigation — so the reader never loses the answer while reading the
 * detail. The rail is desktop-only; on narrower screens the hero already
 * contains everything it echoes.
 *
 * **The interpretation band** breaks the evidence layer in half. Between the
 * flagged signals and the clean ones — the point at which the page is nothing
 * but stacked cards — it steps out of the card rhythm to say where the risk
 * came from. The rail is deliberately not wrapped in a reveal: an animated
 * ancestor becomes its containing block and breaks `position: sticky`.
 */
export default function ReportView({ report }: { report: RiskReport }) {
  const measured = report.signals.filter((s) => s.status === "ok");
  const flagged = measured
    .filter((s) => s.severity !== "none")
    .sort((a, b) => b.points - a.points);
  const passed = measured.filter((s) => s.severity === "none");
  const unmeasured = report.signals.filter((s) => s.status === "unavailable");

  return (
    <div className="space-y-5">
      <Reveal>
        <VerdictHero report={report} />
      </Reveal>

      {report.warnings.length > 0 && (
        <Reveal
          delay={70}
          className="card p-4 text-[13px] leading-relaxed space-y-2"
          style={{
            borderColor: "rgba(250,178,25,0.3)",
            background: "rgba(250,178,25,0.06)",
            color: "#fab219",
          }}
        >
          {report.warnings.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
        </Reveal>
      )}

      {/* ---- Layer 2 ---- */}
      <Reveal className="flex items-center gap-4 pt-4">
        <h2 className="eyebrow shrink-0">Detailed evidence</h2>
        <div
          className="h-px flex-1"
          style={{
            background:
              "linear-gradient(90deg, var(--line-strong), transparent)",
          }}
        />
      </Reveal>

      <div className="flex gap-6 items-start">
        {/*
          Each block below reveals on its own as the reader reaches it, which
          is why there is no container-level stagger here: one stagger fires on
          mount, so anything below the fold would spend its entrance off-screen
          and be static by the time it is scrolled to.
        */}
        <main className="flex-1 min-w-0 space-y-4">
          <Reveal>
            <CategoryProfile categories={report.categories} />
          </Reveal>

          {flagged.length > 0 && (
            <SignalGroup
              id="flagged"
              title="Flagged signals"
              caption="Ordered by how much each contributed to the score"
              signals={flagged}
            />
          )}

          <InterpretationBand report={report} />

          {passed.length > 0 && (
            <SignalGroup
              id="clean"
              title="Signals with no concern"
              caption="Checked and found clean"
              signals={sortByCategory(passed)}
            />
          )}

          <Reveal>
            <DistributionPanel distribution={report.distribution} />
          </Reveal>

          {unmeasured.length > 0 && (
            <SignalGroup
              id="unmeasured"
              title="Could not be measured"
              caption="Excluded from the score rather than guessed at"
              signals={unmeasured}
            />
          )}

          <SourcesPanel report={report} />
          <Disclaimer />
        </main>

        <SummaryRail report={report} />
      </div>
    </div>
  );
}

function SignalGroup({
  id,
  title,
  caption,
  signals,
}: {
  id: string;
  title: string;
  caption: string;
  signals: RiskSignal[];
}) {
  return (
    /*
     * The section element itself is never the reveal: it carries the anchor id
     * the rail and the header navigate to, and an element mid-transform is the
     * wrong thing to scroll to. The heading and the card grid reveal separately
     * inside it — title first, cards a beat later.
     */
    <section id={id} className="anchor">
      <Reveal className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h3 className="text-[15px] font-semibold">
          {title}
          <span className="tnum ml-2 text-xs" style={{ color: "var(--ink-faint)" }}>
            {signals.length}
          </span>
        </h3>
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {caption}
        </p>
      </Reveal>
      <Reveal stagger step={55} delay={60} className="grid gap-3 md:grid-cols-2">
        {signals.map((signal) => (
          <SignalCard key={signal.id} signal={signal} />
        ))}
      </Reveal>
    </section>
  );
}

function SourcesPanel({ report }: { report: RiskReport }) {
  return (
    <Reveal as="section" id="sources" className="anchor card card-lit p-5 sm:p-6">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-[15px] font-semibold">Data sources</h3>
        <p className="text-xs tnum" style={{ color: "var(--ink-muted)" }}>
          {new Date(report.generatedAt).toLocaleString()}
        </p>
      </header>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {report.sources.map((source) => (
          <li key={source.name} className="inset px-3 py-2.5 flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-[5px] h-1.5 w-1.5 rounded-full shrink-0"
              style={{
                background: source.ok ? "var(--sev-none)" : "var(--ink-faint)",
                boxShadow: source.ok ? "0 0 8px rgba(34,197,94,0.5)" : "none",
              }}
            />
            <span className="min-w-0 text-[12px]">
              <span className="font-medium">{source.name}</span>
              <span className="block mt-0.5 leading-relaxed" style={{ color: "var(--ink-muted)" }}>
                {source.detail}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <p
        className="mt-4 pt-3.5 text-[11px] tnum"
        style={{ borderTop: "1px solid var(--line)", color: "var(--ink-faint)" }}
      >
        Analysed in {(report.elapsedMs / 1000).toFixed(1)}s · {report.availableWeight} of{" "}
        {report.totalWeight} signal weight measurable · {report.coveragePercent}% coverage
      </p>
    </Reveal>
  );
}

function Disclaimer() {
  return (
    <Reveal
      as="p"
      className="card p-4 text-[13px] leading-relaxed"
      style={{ color: "var(--ink-secondary)" }}
    >
      <strong style={{ color: "var(--ink)" }}>Not financial advice.</strong> Risk Radar is a
      risk-signal analyser: it reports what is measurable on chain and in market data, and
      nothing else. It is not a scam detector, a safety guarantee, or a prediction of price.
      A clean report is not a guarantee, and a flagged one is not an accusation — many
      legitimate tokens deliberately retain authorities or are newly launched. Risks that
      are invisible here include off-chain promises, team intent, and logic in other
      programs. Every figure shown is either measured or explicitly marked as not measured.
      Always do your own research.
    </Reveal>
  );
}

function sortByCategory(signals: RiskSignal[]): RiskSignal[] {
  return [...signals].sort(
    (a, b) => RISK_CATEGORIES.indexOf(a.category) - RISK_CATEGORIES.indexOf(b.category),
  );
}
