import type { RiskReport, RiskSignal } from "@/lib/risk-engine/types";
import ScoreGauge from "./ScoreGauge";
import SignalCard from "./SignalCard";
import { formatNumber, truncateAddress } from "@/lib/format";
import { scoreColor } from "@/lib/severity";

const CATEGORY_ORDER: RiskSignal["category"][] = ["Authorities", "Holders", "Liquidity", "Market Activity"];

export default function ReportView({ report }: { report: RiskReport }) {
  const { overview } = report;
  const displayName = overview.name || "Unknown Token";
  const displaySymbol = overview.symbol ? overview.symbol.toUpperCase() : null;

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    signals: report.signals.filter((s) => s.category === cat),
  })).filter((g) => g.signals.length > 0);

  return (
    <div className="animate-fade-in-up space-y-6">
      {/* Header / hero */}
      <div
        className="rounded-2xl border p-6 sm:p-8"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <div className="flex flex-col sm:flex-row gap-6 sm:items-center">
          <ScoreGauge score={report.score} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              {overview.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={overview.imageUrl}
                  alt=""
                  className="h-9 w-9 rounded-full object-cover"
                  style={{ border: "1px solid var(--border)" }}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : null}
              <h2 className="text-xl font-semibold">{displayName}</h2>
              {displaySymbol && (
                <span className="text-sm px-2 py-0.5 rounded-md font-mono" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>
                  {displaySymbol}
                </span>
              )}
            </div>
            <p className="font-mono text-sm mt-1 break-all" style={{ color: "var(--muted)" }}>
              {overview.mint}
            </p>
            <div className="mt-4 flex items-center gap-2">
              <span
                className="text-sm font-medium px-3 py-1 rounded-full"
                style={{
                  color: report.score === null ? "var(--muted)" : scoreColor(report.score),
                  background: "var(--surface-2)",
                  border: `1px solid ${report.score === null ? "var(--border)" : scoreColor(report.score)}33`,
                }}
              >
                {report.classification}
              </span>
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                {report.availableWeight}/{report.totalWeight} signal weight available
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4 pt-6" style={{ borderTop: "1px solid var(--border)" }}>
          <Stat label="Price (USD)" value={overview.priceUsd !== null ? `$${overview.priceUsd.toPrecision(6)}` : "—"} />
          <Stat label="Total Supply" value={formatNumber(overview.supplyUi)} />
          <Stat label="Decimals" value={String(overview.decimals)} />
          <Stat label="Mint" value={truncateAddress(overview.mint, 6)} mono />
        </div>
      </div>

      {/* Warnings */}
      {report.warnings.length > 0 && (
        <div
          className="rounded-xl border p-4 text-sm space-y-1"
          style={{ borderColor: "#e3b34155", background: "rgba(227,179,65,0.08)", color: "#e3b341" }}
        >
          {report.warnings.map((w, i) => (
            <p key={i}>⚠ {w}</p>
          ))}
        </div>
      )}

      {/* Signal groups */}
      {grouped.map((group) => (
        <div key={group.category}>
          <h3 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--muted)" }}>
            {group.category}
          </h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {group.signals.map((signal) => (
              <SignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        </div>
      ))}

      {/* Disclaimer */}
      <div
        className="rounded-xl border p-4 text-sm leading-relaxed"
        style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
      >
        <strong style={{ color: "var(--foreground)" }}>Not financial advice.</strong> Solana Risk Radar surfaces
        deterministic, on-chain and market-data risk signals — it does not and cannot determine whether a token is
        &ldquo;safe&rdquo; or a &ldquo;scam.&rdquo; Always do your own research before transacting.
      </div>
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        {label}
      </p>
      <p className={`text-sm font-medium mt-0.5 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}
