import type { RiskReport, RiskSignal } from "@/lib/risk-engine/types";
import { RISK_CATEGORIES } from "@/lib/risk-engine/types";

import VerdictHero from "./VerdictHero";
import SummaryRail from "./SummaryRail";
import CategoryProfile from "./CategoryProfile";
import CleanChecks from "./CleanChecks";
import DistributionPanel from "./DistributionPanel";
import RiskLandscape from "./RiskLandscape";
import Reveal from "./Reveal";
import SectionHead from "./SectionHead";
import SignalLedger from "./SignalLedger";
import SourceStrip from "./SourceStrip";
import styles from "./ReportView.module.css";

/**
 * The full report: one contained verdict, then an open evidence layer.
 *
 * **The verdict hero** spans the full width and answers the question on its
 * own — score, band, why, how many findings at each severity, and the three
 * that mattered most. It is the one place on the page that keeps a card,
 * because it is the result and it should read as a single object.
 *
 * **Everything below it is open.** Each section has a different job, so each
 * has a different composition rather than another rounded rectangle: the risk
 * profile is a chart, the flagged findings are a ledger, the interpretation is
 * a landscape, the clean checks are a matrix, the holders are a ranking, the
 * sources are a strip. The rhythm is the point — scrolling through, the page
 * should change shape as the kind of information changes, instead of showing
 * the same box nine times.
 *
 * **The sticky rail** carries persistent context — a condensed verdict, the
 * findings tally, key market numbers and section navigation — so the reader
 * never loses the answer while reading the detail. It is desktop-only; on
 * narrower screens the hero already contains everything it echoes. It is
 * deliberately not wrapped in a reveal: an animated ancestor becomes its
 * containing block and breaks `position: sticky`.
 */
export default function ReportView({ report }: { report: RiskReport }) {
  const measured = report.signals.filter((s) => s.status === "ok");
  const flagged = measured
    .filter((s) => s.severity !== "none")
    .sort((a, b) => b.points - a.points);
  const passed = measured.filter((s) => s.severity === "none");
  const unmeasured = report.signals.filter((s) => s.status === "unavailable");

  const chargedPoints = flagged.reduce((sum, signal) => sum + signal.points, 0);

  return (
    <div className="space-y-5">
      <Reveal>
        <VerdictHero report={report} />
      </Reveal>

      {report.warnings.length > 0 && (
        <Reveal delay={70} className={styles.warning}>
          {report.warnings.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
        </Reveal>
      )}

      {/* ---- Layer 2 ---- */}
      <Reveal className={styles.layerRule}>
        <h2 className="eyebrow shrink-0">Detailed evidence</h2>
        <div className={styles.layerLine} />
      </Reveal>

      {/*
        Column below xl, where the rail has nowhere to sit and renders as an
        inline summary instead. The items are left to stretch: the rail has to
        match the evidence column's height, because that is the box its sticky
        navigation travels inside.
      */}
      <div className="flex flex-col xl:flex-row gap-6">
        <main className={`flex-1 min-w-0 ${styles.sections}`}>
          <CategoryProfile categories={report.categories} />

          {flagged.length > 0 && (
            <section id="flagged" className="anchor">
              <SectionHead
                eyebrow="Findings"
                title="Flagged signals"
                caption="Ordered by how much each contributed to the score. Every entry opens to the raw data behind it."
                meta={
                  <>
                    {flagged.length} finding{flagged.length === 1 ? "" : "s"} ·{" "}
                    {chargedPoints} pts charged
                  </>
                }
              />
              <SignalLedger signals={flagged} />
            </section>
          )}

          <RiskLandscape report={report} />

          {passed.length > 0 && (
            <section id="clean" className="anchor">
              <SectionHead
                eyebrow="Verified clean"
                title={`${passed.length} checks passed`}
                caption="Measured and found clean, so they charged nothing. Open any one for its explanation and the evidence behind it."
                meta={<>0 pts charged</>}
              />
              <CleanChecks signals={sortByCategory(passed)} />
            </section>
          )}

          <DistributionPanel distribution={report.distribution} />

          {unmeasured.length > 0 && (
            <section id="unmeasured" className="anchor">
              <SectionHead
                eyebrow="Coverage"
                title="Could not be measured"
                caption="Excluded from the score rather than guessed at — a missing measurement is never scored as though it were clean."
                meta={
                  <>
                    {unmeasured.length} signal{unmeasured.length === 1 ? "" : "s"} excluded
                  </>
                }
              />
              <SignalLedger signals={unmeasured} />
            </section>
          )}

          <SourceStrip report={report} />

          <Reveal as="p" className={styles.disclaimer}>
            <strong>Not financial advice.</strong> Risk Radar is a risk-signal analyser: it
            reports what is measurable on chain and in market data, and nothing else. It is
            not a scam detector, a safety guarantee, or a prediction of price. A clean report
            is not a guarantee, and a flagged one is not an accusation — many legitimate
            tokens deliberately retain authorities or are newly launched. Risks that are
            invisible here include off-chain promises, team intent, and logic in other
            programs. Every figure shown is either measured or explicitly marked as not
            measured. Always do your own research.
          </Reveal>
        </main>

        <SummaryRail report={report} />
      </div>
    </div>
  );
}

/**
 * Clean checks are ordered by category rather than by severity, because every
 * one of them sits at the same severity — category order is the only ordering
 * that carries information here.
 */
function sortByCategory(signals: RiskSignal[]): RiskSignal[] {
  return [...signals].sort(
    (a, b) => RISK_CATEGORIES.indexOf(a.category) - RISK_CATEGORIES.indexOf(b.category),
  );
}
