"use client";

import { useState } from "react";

import type { Distribution, DistributionHolder } from "@/lib/risk-engine/types";
import { explorerAccountUrl } from "@/lib/solana/knownAddresses";
import { formatNumber, truncateAddress } from "@/lib/format";

/**
 * The supporting evidence behind the two holder signals.
 *
 * This is the panel that makes concentration auditable: it shows what each of
 * the largest accounts actually is, so a reader can see for themselves why a
 * pool vault or a burn address was not counted as a whale.
 */

const KIND_META: Record<
  DistributionHolder["kind"],
  { label: string; tone: string; note: string }
> = {
  pool: {
    label: "Liquidity pool",
    tone: "#38d6ec",
    note: "Tokens held in a DEX pool vault — tradable liquidity, not a holder who can dump.",
  },
  burn: {
    label: "Burned",
    tone: "#6f778c",
    note: "Permanently removed from circulation and excluded from the supply denominator.",
  },
  custodian: {
    label: "Exchange",
    tone: "#a3c940",
    note: "A known custodial exchange wallet holding many customers' balances.",
  },
  contract: {
    label: "Program account",
    tone: "#fab219",
    note: "Controlled by an on-chain program — often vesting, staking or escrow.",
  },
  wallet: {
    label: "Wallet",
    tone: "#eef1f7",
    note: "An ordinary wallet. These are the holders counted toward concentration.",
  },
};

const PREVIEW_COUNT = 8;

export default function DistributionPanel({
  distribution,
}: {
  distribution: Distribution;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!distribution.available || distribution.holders.length === 0) {
    return (
      <section id="distribution" className="anchor card card-lit p-5 sm:p-6">
        <h3 className="text-[15px] font-semibold">Holder distribution</h3>
        <p className="text-sm mt-2.5 leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
          {distribution.reason ??
            "Holder data could not be retrieved for this token, so concentration was excluded from the score."}
        </p>
      </section>
    );
  }

  const visible = expanded
    ? distribution.holders
    : distribution.holders.slice(0, PREVIEW_COUNT);
  const kindsPresent = [...new Set(distribution.holders.map((h) => h.kind))];
  const maxShare = Math.max(...distribution.holders.map((h) => h.share), 0.0001);

  return (
    <section id="distribution" className="anchor card card-lit p-5 sm:p-6">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-[15px] font-semibold">Holder distribution</h3>
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {distribution.holders.length} largest token accounts, classified
        </p>
      </header>

      <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Metric
          label="Largest holder"
          value={
            distribution.topHolderShare !== null ? pct(distribution.topHolderShare) : "—"
          }
          hint="of circulating supply"
          emphasis
        />
        <Metric
          label="Holders 2–10"
          value={distribution.next9Share !== null ? pct(distribution.next9Share) : "—"}
          hint={
            distribution.top10Share !== null
              ? `top 10 combined: ${pct(distribution.top10Share)}`
              : "of circulating supply"
          }
          emphasis
        />
        <Metric
          label="In DEX pools"
          value={pct(distribution.pooledShare)}
          hint={`of supply, across these ${distribution.holders.length}`}
        />
        <Metric
          label="Burned"
          value={pct(distribution.burnedShare)}
          hint={`of supply, across these ${distribution.holders.length}`}
        />
      </div>

      <ol className="mt-5 space-y-2.5">
        {visible.map((holder, index) => {
          const meta = KIND_META[holder.kind];
          const address = holder.owner ?? holder.tokenAccount;
          const excluded = holder.kind === "pool" || holder.kind === "burn";

          return (
            <li
              key={holder.tokenAccount}
              className="grid grid-cols-[1.25rem_1fr_auto] items-center gap-3"
            >
              <span
                className="tnum text-[11px] text-right"
                style={{ color: "var(--ink-faint)" }}
              >
                {index + 1}
              </span>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href={explorerAccountUrl(address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[12px] underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--accent)]"
                  >
                    {truncateAddress(address, 6)}
                  </a>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{
                      color: meta.tone,
                      border: `1px solid ${meta.tone}3d`,
                      background: `${meta.tone}12`,
                    }}
                    title={meta.note}
                  >
                    {holder.label ?? meta.label}
                  </span>
                  {excluded && (
                    <span className="text-[10px]" style={{ color: "var(--ink-faint)" }}>
                      not counted
                    </span>
                  )}
                </div>
                <div
                  className="mt-1.5 h-1.5 rounded-full overflow-hidden"
                  style={{ background: "rgba(255,255,255,0.05)" }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      // Scaled to the largest holder so small tails stay visible.
                      width: `${Math.max((holder.share / maxShare) * 100, 1.5)}%`,
                      background: excluded
                        ? "rgba(255,255,255,0.16)"
                        : `linear-gradient(90deg, ${meta.tone}59, ${meta.tone})`,
                      transition: "width 0.9s cubic-bezier(0.16,1,0.3,1)",
                    }}
                  />
                </div>
              </div>

              <div className="text-right">
                <div className="tnum text-[13px] font-medium">{pct(holder.share)}</div>
                <div className="tnum text-[10px]" style={{ color: "var(--ink-faint)" }}>
                  {formatNumber(holder.amountUi)}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {distribution.holders.length > PREVIEW_COUNT && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-4 chip px-3 py-1.5 text-xs cursor-pointer"
        >
          {expanded ? "Show fewer" : `Show all ${distribution.holders.length} accounts`}
        </button>
      )}

      <div
        className="mt-5 pt-4 text-[11px] leading-relaxed space-y-1.5"
        style={{ borderTop: "1px solid var(--line)", color: "var(--ink-faint)" }}
      >
        <p>
          The largest holder and holders 2&ndash;10 are scored separately because the
          familiar &ldquo;top 10&rdquo; figure <em>contains</em> the largest holder — across
          real tokens the two correlate at r&nbsp;=&nbsp;0.92, so charging both would count
          one wallet twice. The top-10 total is still shown above for reference.
        </p>
        <p>
          Pool and burn shares are measured across these {distribution.holders.length}{" "}
          accounts only. A token whose liquidity is spread thinly over many small pools can
          therefore show a low pooled share while still having deep total liquidity — see
          the Liquidity Depth signal for the market-wide figure.
        </p>
        <div className="pt-1 flex flex-wrap gap-x-4 gap-y-1">
          {kindsPresent.map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: KIND_META[kind].tone }}
              />
              <span style={{ color: "var(--ink-muted)" }}>{KIND_META[kind].label}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className="inset p-3"
      style={emphasis ? { borderColor: "var(--line-strong)" } : undefined}
    >
      <div className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
        {label}
      </div>
      <div
        className="tnum text-xl font-semibold mt-1"
        style={{ color: emphasis ? "var(--ink)" : "var(--ink-secondary)" }}
      >
        {value}
      </div>
      <div className="text-[10px] mt-0.5" style={{ color: "var(--ink-faint)" }}>
        {hint}
      </div>
    </div>
  );
}

function pct(fraction: number): string {
  if (fraction > 0 && fraction < 0.0001) return "<0.01%";
  return `${(fraction * 100).toFixed(2)}%`;
}
