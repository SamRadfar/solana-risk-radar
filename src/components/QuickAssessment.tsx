import type { RiskReport } from "@/lib/risk-engine/types";
import { CLASSIFICATION_SUMMARY, SEVERITY_META, UNAVAILABLE_META, scoreColor } from "@/lib/severity";
import { explorerTokenUrl } from "@/lib/solana/knownAddresses";
import { formatNumber, formatPrice, formatUsd, truncateAddress } from "@/lib/format";

import ScoreGauge from "./ScoreGauge";

/**
 * The quick-assessment layer.
 *
 * Everything needed to understand the verdict in 10–20 seconds without reading
 * the report: the score, what band it falls in, why it landed there, how many
 * findings of each severity there are, and the three that mattered most.
 *
 * All of it is derived from the same signals that produced the score — the
 * rationale sentence is assembled from measured category thresholds, never
 * written by a model.
 */
export default function QuickAssessment({ report }: { report: RiskReport }) {
  const { overview, summary } = report;
  const name = overview.name ?? "Unnamed token";
  const symbol = overview.symbol?.toUpperCase() ?? null;
  const color = report.score === null ? "var(--muted)" : scoreColor(report.score);

  return (
    <section
      className="rounded-2xl border p-5 sm:p-7"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      aria-labelledby="quick-assessment-heading"
    >
      <h2 id="quick-assessment-heading" className="sr-only">
        Quick assessment
      </h2>

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
            <h3 className="text-xl font-semibold truncate">{name}</h3>
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
            {report.coveragePercent < 100 && (
              <span className="text-sm font-normal" style={{ color: "var(--muted)" }}>
                {" "}
                · from partial data
              </span>
            )}
          </div>

          {/* The deterministic "why this score" sentence. */}
          <p
            className="mt-1.5 text-sm leading-relaxed max-w-prose"
            style={{ color: "var(--foreground)" }}
          >
            {summary.rationale}
          </p>
          <p
            className="mt-1.5 text-sm leading-relaxed max-w-prose"
            style={{ color: "var(--muted)" }}
          >
            {CLASSIFICATION_SUMMARY[report.classification]}
          </p>
        </div>
      </div>

      {/* Findings at a glance */}
      <div
        className="mt-6 pt-5 flex flex-wrap gap-x-5 gap-y-2"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <Count label="Critical" value={summary.counts.critical} meta={SEVERITY_META.critical} />
        <Count label="High" value={summary.counts.high} meta={SEVERITY_META.high} />
        <Count label="Medium" value={summary.counts.medium} meta={SEVERITY_META.medium} />
        <Count label="Low" value={summary.counts.low} meta={SEVERITY_META.low} />
        <Count label="No concern" value={summary.counts.none} meta={SEVERITY_META.none} />
        {summary.counts.unavailable > 0 && (
          <Count
            label="Not measured"
            value={summary.counts.unavailable}
            meta={UNAVAILABLE_META}
          />
        )}
      </div>

      {/* The three findings that contributed most */}
      {summary.topConcerns.length > 0 && (
        <div className="mt-5">
          <h4
            className="text-xs uppercase tracking-[0.14em] mb-2.5"
            style={{ color: "var(--muted)" }}
          >
            Main concerns
          </h4>
          <ol className="space-y-1.5">
            {summary.topConcerns.map((concern, index) => {
              const meta = SEVERITY_META[concern.severity];
              return (
                <li key={concern.id} className="flex items-baseline gap-2.5 text-sm">
                  <span className="tnum text-xs shrink-0" style={{ color: "var(--muted)" }}>
                    {index + 1}
                  </span>
                  <span className="shrink-0">{concern.label}</span>
                  <span style={{ color: "var(--muted)" }}>—</span>
                  <span className="font-mono text-[13px] min-w-0" style={{ color: meta.color }}>
                    {concern.observedValue}
                  </span>
                  {/* Severity in words, never carried by colour alone. */}
                  <span
                    className="text-[11px] shrink-0 flex items-center gap-1"
                    style={{ color: meta.color }}
                  >
                    <span aria-hidden="true">{meta.glyph}</span>
                    {meta.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {summary.topConcerns.length === 0 && (
        <p className="mt-5 text-sm" style={{ color: "var(--muted-strong)" }}>
          No signal was flagged at any severity. This is not a safety guarantee — it means
          every check that could be measured came back clean.
        </p>
      )}

      {/* Token facts */}
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
        {[...overview.websites.slice(0, 2), ...overview.socials.slice(0, 3)].map((url) => (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="underline decoration-dotted underline-offset-2"
            style={{ color: "var(--muted-strong)" }}
          >
            {hostOf(url)}
          </a>
        ))}
      </div>
    </section>
  );
}

function Count({
  label,
  value,
  meta,
}: {
  label: string;
  value: number;
  meta: { color: string; glyph: string };
}) {
  const muted = value === 0;
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        aria-hidden="true"
        className="text-[10px]"
        style={{ color: muted ? "var(--border-strong)" : meta.color }}
      >
        {meta.glyph}
      </span>
      <span
        className="tnum text-lg font-medium"
        style={{ color: muted ? "var(--muted)" : meta.color }}
      >
        {value}
      </span>
      <span className="text-xs" style={{ color: "var(--muted)" }}>
        {label}
      </span>
    </div>
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

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
