import type { RiskReport, Severity } from "@/lib/risk-engine/types";
import {
  CLASSIFICATION_SUMMARY,
  SEVERITY_META,
  UNAVAILABLE_META,
  scoreMeta,
} from "@/lib/severity";
import { explorerTokenUrl } from "@/lib/solana/knownAddresses";
import { formatNumber, formatPrice, formatUsd, truncateAddress } from "@/lib/format";

import MarketContextChart from "./MarketContextChart";
import ScoreDial from "./ScoreDial";

/**
 * The hero verdict — the whole answer, above the fold.
 *
 * Deliberately self-sufficient: a reader who never scrolls past this card
 * still learns what the token is, what the verdict is, why it landed there,
 * how many findings there are and which three mattered most. The sticky rail
 * echoes a condensed version of this for scroll context; the detail below
 * carries the argument.
 *
 * The upper half is split: the verdict on the left, four hours of price
 * movement on the right. The chart is context and is labelled as such — it is
 * never an input to the score, and it sits beside the verdict rather than
 * inside it so the two are not read as one claim. Everything below the split
 * — the main concerns, the token facts, the links — stays full width, because
 * those are the verdict's own supporting detail.
 */
export default function VerdictHero({ report }: { report: RiskReport }) {
  const { overview, summary } = report;
  const meta = scoreMeta(report.score);
  const symbol = overview.symbol?.toUpperCase() ?? null;

  const counts: { key: Severity | "unavailable"; value: number }[] = [
    { key: "critical", value: summary.counts.critical },
    { key: "high", value: summary.counts.high },
    { key: "medium", value: summary.counts.medium },
    { key: "low", value: summary.counts.low },
    { key: "none", value: summary.counts.none },
    { key: "unavailable", value: summary.counts.unavailable },
  ];

  return (
    <section id="verdict" className="anchor card card-lit overflow-hidden">
      {/* A severity-tinted wash behind the dial ties the card to the verdict. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(58% 90% at 16% 0%, ${meta.soft} 0%, transparent 68%)`,
        }}
      />

      <div className="relative p-6 sm:p-8">
        <div className="grid gap-7 lg:gap-8 lg:grid-cols-[60fr_40fr] items-stretch">
          <div className="flex flex-col sm:flex-row sm:items-center gap-7 lg:gap-8">
          <div className="flex justify-center sm:justify-start shrink-0">
            <ScoreDial
              score={report.score}
              classification={report.classification}
              size={196}
            />
          </div>

          <div className="min-w-0 flex-1">
            {/* Identity */}
            <div className="flex items-center gap-3 flex-wrap">
              {overview.imageUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={overview.imageUrl}
                  alt=""
                  className="h-9 w-9 rounded-full object-cover"
                  style={{ border: "1px solid var(--line-strong)" }}
                />
              )}
              <h2 className="text-2xl sm:text-[28px] font-semibold display truncate">
                {overview.name ?? "Unnamed token"}
              </h2>
              {symbol && (
                <span
                  className="font-mono text-[11px] px-2 py-1 rounded-md"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid var(--line)",
                    color: "var(--ink-secondary)",
                  }}
                >
                  {symbol}
                </span>
              )}
            </div>

            {/* Verdict */}
            <div className="mt-4 flex items-baseline gap-3 flex-wrap">
              <span
                className="text-[26px] sm:text-[32px] font-semibold display"
                style={{ color: meta.color }}
              >
                {report.classification}
              </span>
              {report.coveragePercent < 100 && (
                <span
                  className="text-[12px] px-2 py-1 rounded-full"
                  style={{
                    border: "1px solid var(--line)",
                    color: "var(--ink-muted)",
                  }}
                >
                  from partial data · {report.coveragePercent}% coverage
                </span>
              )}
            </div>

            {/* Deterministic rationale — the "why" */}
            <p className="mt-3 text-[15px] sm:text-base leading-relaxed max-w-2xl">
              {summary.rationale}
            </p>
            <p
              className="mt-2 text-sm leading-relaxed max-w-2xl"
              style={{ color: "var(--ink-muted)" }}
            >
              {CLASSIFICATION_SUMMARY[report.classification]}
            </p>

            {/* Findings tally */}
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
              {counts.map(({ key, value }) => {
                const m = key === "unavailable" ? UNAVAILABLE_META : SEVERITY_META[key];
                const dim = value === 0;
                return (
                  <div key={key} className="flex items-baseline gap-1.5">
                    <span
                      aria-hidden="true"
                      className="text-[10px]"
                      style={{ color: dim ? "var(--ink-faint)" : m.color }}
                    >
                      {m.glyph}
                    </span>
                    <span
                      className="tnum text-lg font-semibold"
                      style={{ color: dim ? "var(--ink-faint)" : m.color }}
                    >
                      {value}
                    </span>
                    <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                      {m.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          </div>

          <MarketContextChart report={report} />
        </div>

        {/* Main concerns */}
        <div className="mt-7 pt-6" style={{ borderTop: "1px solid var(--line)" }}>
          {summary.topConcerns.length > 0 ? (
            <>
              <div className="eyebrow mb-3">Main concerns</div>
              <div className="grid gap-2.5 sm:grid-cols-3">
                {summary.topConcerns.map((concern, index) => {
                  const m = SEVERITY_META[concern.severity];
                  return (
                    <div
                      key={concern.id}
                      className="inset p-3.5 relative overflow-hidden"
                      style={{ borderColor: m.border, background: m.soft }}
                    >
                      <div
                        aria-hidden="true"
                        className="absolute left-0 top-0 bottom-0 w-[2px]"
                        style={{ background: m.color }}
                      />
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="tnum text-[10px]"
                          style={{ color: "var(--ink-faint)" }}
                        >
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span
                          className="text-[10px] flex items-center gap-1"
                          style={{ color: m.color }}
                        >
                          <span aria-hidden="true">{m.glyph}</span>
                          {m.label}
                        </span>
                      </div>
                      <div className="mt-1.5 text-sm font-medium">{concern.label}</div>
                      <div
                        className="mt-1 font-mono text-[12px] break-words"
                        style={{ color: m.color }}
                      >
                        {concern.observedValue}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-sm" style={{ color: "var(--ink-secondary)" }}>
              No signal was flagged at any severity. This is not a safety guarantee — it
              means every check that could be measured came back clean.
            </p>
          )}
        </div>

        {/* Token facts */}
        <div
          className="mt-6 pt-5 grid grid-cols-2 sm:grid-cols-4 gap-4"
          style={{ borderTop: "1px solid var(--line)" }}
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
            value={
              overview.supplyIsMeaningful ? formatNumber(overview.supplyUi) : "0 (reported)"
            }
          />
          <Stat label="Token program" value={overview.tokenProgram} mono />
        </div>

        <div className="mt-4 flex items-center gap-2.5 flex-wrap text-xs">
          <a
            href={explorerTokenUrl(overview.mint)}
            target="_blank"
            rel="noopener noreferrer"
            className="chip font-mono px-2.5 py-1"
          >
            {truncateAddress(overview.mint, 8)} ↗
          </a>
          {[...overview.websites.slice(0, 2), ...overview.socials.slice(0, 3)].map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="chip px-2.5 py-1"
            >
              {hostOf(url)}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
        {label}
      </div>
      <div
        className={`tnum mt-1 font-medium break-words ${mono ? "font-mono text-[13px]" : "text-[15px]"}`}
      >
        {value}
      </div>
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
