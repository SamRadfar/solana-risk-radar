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
    tone: "#5eead4",
    note: "Tokens held in a DEX pool vault — tradable liquidity, not a holder who can dump.",
  },
  burn: {
    label: "Burned",
    tone: "#8c92a4",
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
    tone: "#e8eaf0",
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
      <section
        className="rounded-2xl border p-5 sm:p-6"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <h3 className="text-sm font-semibold">Holder distribution</h3>
        <p className="text-sm mt-2 leading-relaxed" style={{ color: "var(--muted-strong)" }}>
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

  return (
    <section
      className="rounded-2xl border p-5 sm:p-6"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      aria-labelledby="distribution-heading"
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 id="distribution-heading" className="text-sm font-semibold">
          Holder distribution
        </h3>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {distribution.holders.length} largest token accounts
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric
          label="Largest holder"
          value={distribution.topHolderShare !== null ? formatPct(distribution.topHolderShare) : "—"}
          hint="of circulating supply"
        />
        <Metric
          label="Holders 2–10"
          value={distribution.next9Share !== null ? formatPct(distribution.next9Share) : "—"}
          hint={
            distribution.top10Share !== null
              ? `top 10 combined: ${formatPct(distribution.top10Share)}`
              : "of circulating supply"
          }
        />
        <Metric
          label="In DEX pools"
          value={formatPct(distribution.pooledShare)}
          hint={`of supply, across these ${distribution.holders.length}`}
        />
        <Metric
          label="Burned"
          value={formatPct(distribution.burnedShare)}
          hint={`of supply, across these ${distribution.holders.length}`}
        />
      </div>

      <ol className="mt-5 space-y-2">
        {visible.map((holder, index) => {
          const meta = KIND_META[holder.kind];
          const address = holder.owner ?? holder.tokenAccount;
          const excluded = holder.kind === "pool" || holder.kind === "burn";

          return (
            <li
              key={holder.tokenAccount}
              className="grid grid-cols-[1.5rem_1fr_auto] items-center gap-3 text-sm"
            >
              <span className="tnum text-xs" style={{ color: "var(--muted)" }}>
                {index + 1}
              </span>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href={explorerAccountUrl(address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs underline decoration-dotted underline-offset-2"
                    style={{ color: "var(--foreground)" }}
                  >
                    {truncateAddress(address, 6)}
                  </a>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded border"
                    style={{
                      color: meta.tone,
                      borderColor: `${meta.tone}44`,
                      background: `${meta.tone}14`,
                    }}
                    title={meta.note}
                  >
                    {holder.label ?? meta.label}
                  </span>
                  {excluded && (
                    <span className="text-[10px]" style={{ color: "var(--muted)" }}>
                      excluded from concentration
                    </span>
                  )}
                </div>
                <div
                  className="mt-1 h-1.5 rounded-full overflow-hidden"
                  style={{ background: "var(--surface-3)" }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(holder.share * 100, holder.share > 0 ? 1 : 0)}%`,
                      background: excluded ? "var(--border-strong)" : meta.tone,
                    }}
                  />
                </div>
              </div>

              <div className="text-right">
                <div className="tnum text-sm">{formatPct(holder.share)}</div>
                <div className="tnum text-[10px]" style={{ color: "var(--muted)" }}>
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
          className="mt-4 text-xs font-medium cursor-pointer"
          style={{ color: "var(--accent-dim)" }}
        >
          {expanded
            ? "Show fewer"
            : `Show all ${distribution.holders.length} accounts`}
        </button>
      )}

      <div
        className="mt-5 pt-4 text-xs leading-relaxed space-y-1"
        style={{ borderTop: "1px solid var(--border)", color: "var(--muted)" }}
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
          therefore show a low pooled share while still having deep total liquidity &mdash;
          see the Liquidity Depth signal for the market-wide figure.
        </p>
        {kindsPresent.map((kind) => (
          <p key={kind}>
            <span style={{ color: KIND_META[kind].tone }}>{KIND_META[kind].label}</span> —{" "}
            {KIND_META[kind].note}
          </p>
        ))}
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div
      className="rounded-lg border p-3"
      style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
    >
      <p className="text-[11px]" style={{ color: "var(--muted)" }}>
        {label}
      </p>
      <p className="tnum text-lg font-medium mt-0.5">{value}</p>
      <p className="text-[10px]" style={{ color: "var(--muted)" }}>
        {hint}
      </p>
    </div>
  );
}

function formatPct(fraction: number): string {
  if (fraction > 0 && fraction < 0.0001) return "<0.01%";
  return `${(fraction * 100).toFixed(2)}%`;
}
