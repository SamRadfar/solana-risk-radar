import type { RiskReport, RiskSignal } from "@/lib/risk-engine/types";
import { RISK_CATEGORIES } from "@/lib/risk-engine/types";
import { CLASSIFICATION_SUMMARY, scoreColor } from "@/lib/severity";
import { explorerTokenUrl } from "@/lib/solana/knownAddresses";
import { formatNumber, formatPrice, formatUsd, truncateAddress } from "@/lib/format";

import ScoreGauge from "./ScoreGauge";
import CategoryProfile from "./CategoryProfile";
import DistributionPanel from "./DistributionPanel";
import SignalCard from "./SignalCard";

/**
 * The full report.
 *
 * Reading order is deliberate: the verdict and what it means first (the
 * five-second read), then the category profile, then the flagged signals, then
 * everything that passed, then the raw distribution and provenance. Detail is
 * always available but never in the way.
 */
export default function ReportView({ report }: { report: RiskReport }) {
  const { overview } = report;
  const name = overview.name ?? "Unnamed token";
  const symbol = overview.symbol?.toUpperCase() ?? null;
  const color = report.score === null ? "var(--muted)" : scoreColor(report.score);

  const measured = report.signals.filter((s) => s.status === "ok");
  const flagged = measured
    .filter((s) => s.severity !== "none")
    .sort((a, b) => b.points - a.points);
  const passed = measured.filter((s) => s.severity === "none");
  const unmeasured = report.signals.filter((s) => s.status === "unavailable");

  return (
    <div className="animate-fade-in-up space-y-5">
      {/* Verdict */}
      <section
        className="rounded-2xl border p-5 sm:p-7"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 sm:items-center">
          <ScoreGauge score={report.score} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              {overview.imageUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={overview.imageUrl}
                  alt=""
                  className="h-8 w-8 rounded-full object-cover"
                  style={{ border: "1px solid var(--border)" }}
                />
              )}
              <h2 className="text-xl font-semibold truncate">{name}</h2>
              {symbol && (
                <span
                  className="text-xs px-2 py-0.5 rounded font-mono"
                  style={{ background: "var(--surface-3)", color: "var(--muted-strong)" }}
                >
                  {symbol}
                </span>
              )}
            </div>

            <div className="mt-3 text-lg font-medium" style={{ color }}>
              {report.classification}
              {/*
                A headline like "Low Risk Signals" reads as reassuring, so it
                must never stand alone when the signals that went unmeasured
                might be the damning ones. The qualifier rides on the verdict
                itself, not only in the banner below it.
              */}
              {report.coveragePercent < 100 && (
                <span className="text-sm font-normal" style={{ color: "var(--muted)" }}>
                  {" "}
                  · from partial data
                </span>
              )}
            </div>
            <p
              className="mt-1.5 text-sm leading-relaxed max-w-prose"
              style={{ color: "var(--muted-strong)" }}
            >
              {CLASSIFICATION_SUMMARY[report.classification]}
            </p>

            <div
              className="mt-4 flex items-center gap-x-4 gap-y-1 flex-wrap text-xs"
              style={{ color: "var(--muted)" }}
            >
              <span className="tnum">
                {flagged.length} of {measured.length} measured signals flagged
              </span>
              <span className="tnum">{report.coveragePercent}% signal coverage</span>
              <span className="tnum">analysed in {(report.elapsedMs / 1000).toFixed(1)}s</span>
            </div>
          </div>
        </div>

        <div
          className="mt-6 pt-5 grid grid-cols-2 sm:grid-cols-4 gap-4"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <Stat
            label="Price"
            value={overview.priceUsd !== null ? formatPrice(overview.priceUsd) : "—"}
          />
          <Stat
            label="Market cap"
            value={overview.marketCapUsd !== null ? formatUsd(overview.marketCapUsd) : "—"}
          />
          <Stat
            label="Total supply"
            value={overview.supplyIsMeaningful ? formatNumber(overview.supplyUi) : "0 (reported)"}
          />
          <Stat label="Token program" value={overview.tokenProgram} />
        </div>

        <div className="mt-4 flex items-center gap-3 flex-wrap text-xs">
          <a
            href={explorerTokenUrl(overview.mint)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono underline decoration-dotted underline-offset-2"
            style={{ color: "var(--accent)" }}
          >
            {truncateAddress(overview.mint, 8)}
          </a>
          {overview.websites.slice(0, 2).map((url) => (
            <ExternalLink key={url} href={url} label={hostOf(url)} />
          ))}
          {overview.socials.slice(0, 3).map((url) => (
            <ExternalLink key={url} href={url} label={hostOf(url)} />
          ))}
        </div>
      </section>

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
          Generated {new Date(report.generatedAt).toLocaleString()} · score normalised over{" "}
          {report.availableWeight} of {report.totalWeight} total signal weight
        </p>
      </section>

      <p
        className="rounded-xl border p-4 text-sm leading-relaxed"
        style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted-strong)" }}
      >
        <strong style={{ color: "var(--foreground)" }}>Not financial advice.</strong> Risk
        Radar reports verifiable on-chain and market signals. It cannot determine whether a
        token is &ldquo;safe&rdquo; or a &ldquo;scam&rdquo;: a clean report is not a
        guarantee, and a flagged one is not an accusation. Many legitimate tokens
        deliberately retain authorities, and many risks &mdash; off-chain promises, team
        intent, contract logic in other programs &mdash; are not visible here at all. Always
        do your own research.
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
    (a, b) =>
      RISK_CATEGORIES.indexOf(a.category) - RISK_CATEGORIES.indexOf(b.category),
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px]" style={{ color: "var(--muted)" }}>
        {label}
      </p>
      <p className="tnum text-sm font-medium mt-0.5 break-words">{value}</p>
    </div>
  );
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="underline decoration-dotted underline-offset-2"
      style={{ color: "var(--muted-strong)" }}
    >
      {label}
    </a>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
