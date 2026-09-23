"use client";

import { useState } from "react";

import type {
  LiquiditySafety,
  LiquiditySafetyPool,
  LpCustodyClass,
} from "@/lib/risk-engine/types";
import { explorerTokenUrl } from "@/lib/solana/knownAddresses";
import { formatUsd, truncateAddress } from "@/lib/format";

import Reveal from "./Reveal";
import SectionHead from "./SectionHead";
import styles from "./LiquiditySafetyPanel.module.css";

/**
 * Liquidity safety — who can withdraw the pools, and who provably cannot.
 *
 * The holder panel below answers "can one wallet dump this?". This answers the
 * other half of the same question: "can one wallet remove the market itself?".
 * It is composed the same way — figures set as figures, then one full-width
 * bar, then the per-pool evidence — so it reads as a sibling of the holder
 * ranking rather than a new kind of box.
 *
 * **It is informational.** Nothing here is scored. Every percentage is a share
 * of the liquidity that could actually be measured, and the coverage figure
 * sits beside them saying how much of the market that was. Where nothing could
 * be measured the panel says "Not measured" and shows no bar at all — a
 * missing measurement must never render as 0% unlocked, which would read as
 * the strongest possible safety claim.
 */

const CUSTODY_META: Record<LpCustodyClass, { label: string; note: string }> = {
  burned: {
    label: "Burned",
    note: "LP held where it can never be redeemed, so the pool reserves behind it are permanently stranded.",
  },
  frozen: {
    label: "Frozen",
    note: "The LP token account is frozen and cannot be transferred. The freeze authority can lift this, so it is not permanent.",
  },
  "lock-program": {
    label: "Lock program",
    note: "Custodied by a known LP lock program. The release schedule could not be read, so this is disclosed but not counted as locked.",
  },
  staked: {
    label: "Farm / staked",
    note: "Deposited in a farm or staking program. The depositor can withdraw it at any time — this is not a lock.",
  },
  program: {
    label: "Program account",
    note: "Owned by an on-chain program rather than a wallet. No lock is implied.",
  },
  wallet: {
    label: "Wallet",
    note: "An ordinary wallet. This LP can be redeemed for the pool's reserves at any time.",
  },
  unknown: {
    label: "Unknown",
    note: "The holding account's owner could not be resolved. Counted as withdrawable, because assuming otherwise would invent a lock.",
  },
};

const VERIFICATION: Record<
  LiquiditySafety["confidence"],
  { label: string; tone: string; note: string }
> = {
  high: {
    label: "Verified",
    tone: "#22c55e",
    note: "Nearly all of this token's liquidity sits in pools whose LP custody was read directly from chain.",
  },
  medium: {
    label: "Partial",
    tone: "#fab219",
    note: "Some of this token's liquidity was measured; the rest sits in pools with no readable LP token. The percentages describe the measured part only.",
  },
  low: {
    label: "Partial",
    tone: "#fab219",
    note: "Only a minority of this token's liquidity could be measured. Treat the percentages as describing that minority, not the whole market.",
  },
  none: {
    label: "Unknown",
    tone: "#6f778c",
    note: "No pool's LP custody could be read, so no lock or burn percentage is claimed.",
  },
};

const PREVIEW_POOLS = 4;

export default function LiquiditySafetyPanel({ safety }: { safety: LiquiditySafety }) {
  const [expanded, setExpanded] = useState(false);

  const head = (
    <SectionHead
      eyebrow="Liquidity"
      title="Liquidity safety"
      caption="Whether the pools backing this token can be withdrawn — measured from each pool's LP token supply and the accounts holding it, never from the project's own claims."
      meta={
        // "0% of liquidity measured" sits one line above a heading about
        // locking, where it can be misread as "0% locked". When nothing was
        // read the prose below says so in words instead.
        safety.coverage !== null && safety.coverage > 0 ? (
          <>{pct(safety.coverage, 0)} of liquidity measured</>
        ) : safety.status === "unmeasured" ? (
          <>not measured</>
        ) : undefined
      }
    />
  );

  // Nothing to measure, or nothing measurable: say so, and show no figures.
  if (safety.status === "no-liquidity" || safety.status === "unmeasured") {
    return (
      <section id="liquidity-safety" className="anchor">
        {head}
        <Reveal as="p" className={styles.absent}>
          {safety.status === "no-liquidity"
            ? "This token has no measurable pooled liquidity, so there is no LP custody to report."
            : "None of this token's liquidity could be measured for lock or burn status, so no percentage is reported. This is not a finding that liquidity is unlocked — it is the absence of a measurement."}
        </Reveal>
        {safety.notes.length > 0 && (
          <div className={styles.notes}>
            {safety.notes.map((note, index) => (
              <p key={index}>{note}</p>
            ))}
          </div>
        )}
      </section>
    );
  }

  const verification = VERIFICATION[safety.confidence];
  const visible = expanded ? safety.pools : safety.pools.slice(0, PREVIEW_POOLS);

  const segments = [
    { key: "burned", label: "Burned", value: safety.burnedPercent, tone: "#22c55e" },
    {
      key: "frozen",
      label: "Frozen",
      value: subtract(safety.lockedPercent, safety.burnedPercent),
      tone: "#4ade80",
    },
    {
      key: "custody",
      label: "Lock custody",
      value: safety.lockCustodyPercent,
      tone: "#38d6ec",
    },
    {
      key: "withdrawable",
      label: "Withdrawable",
      value: safety.unlockedPercent,
      tone: "#fab219",
    },
    {
      key: "unattributed",
      label: "Not attributed",
      value: safety.unattributedPercent,
      tone: "#6f778c",
    },
  ].filter((segment) => (segment.value ?? 0) > 0);

  return (
    <section id="liquidity-safety" className="anchor">
      {head}

      <Reveal className={styles.metrics}>
        <Metric
          label="Total liquidity"
          value={
            safety.totalLiquidityUsd !== null ? formatUsd(safety.totalLiquidityUsd) : "—"
          }
          hint={`${formatUsd(safety.measuredLiquidityUsd)} of it measured`}
          emphasis
        />
        <Metric
          label="Locked liquidity"
          value={measure(safety.lockedPercent)}
          hint={
            safety.burnedPercent !== null
              ? `of which burned: ${pct(safety.burnedPercent)}`
              : "of measured liquidity"
          }
          emphasis
        />
        <Metric
          label="Withdrawable"
          value={measure(safety.unlockedPercent)}
          hint="can be redeemed for pool reserves"
          emphasis
        />
        <Metric
          label="Lock expiry"
          value={safety.lockExpiry === "permanent" ? "Permanent" : "Not measured"}
          hint={
            safety.lockExpiry === "permanent"
              ? "burned LP cannot be redeemed"
              : "no expiry could be verified"
          }
        />
      </Reveal>

      {segments.length > 0 && (
        <>
          <Reveal className={styles.bar}>
            {segments.map((segment) => (
              <span
                key={segment.key}
                className={styles.segment}
                title={`${segment.label}: ${pct(segment.value as number)}`}
                style={
                  {
                    "--share": segment.value as number,
                    background: segment.tone,
                  } as React.CSSProperties
                }
              />
            ))}
          </Reveal>

          <div className={styles.legend}>
            {segments.map((segment) => (
              <span key={segment.key} className={styles.legendItem}>
                <span
                  aria-hidden="true"
                  className={styles.legendDot}
                  style={{ background: segment.tone }}
                />
                <span>{segment.label}</span>
                <span className={`tnum ${styles.legendValue}`}>
                  {pct(segment.value as number)}
                </span>
              </span>
            ))}
          </div>
        </>
      )}

      <Reveal as="dl" className={styles.facts}>
        <Fact
          label="Verification"
          value={verification.label}
          tone={verification.tone}
          note={verification.note}
        />
        <Fact
          label="Lock mechanism"
          value={safety.lockProvider ?? "None observed"}
          note={
            safety.lockProvider
              ? "The burn destinations and lock programs actually observed holding this token's LP."
              : "No burn address or known lock program was found holding any of the measured LP."
          }
        />
        <Fact
          label="Source"
          value="On-chain (Solana RPC)"
          note={
            safety.sources[0] ??
            "LP mint supply and holder custody, read directly from chain."
          }
        />
      </Reveal>

      <Reveal as="ol" className={styles.pools}>
        {visible.map((pool) => (
          <PoolRow key={pool.pairAddress} pool={pool} />
        ))}
      </Reveal>

      {safety.pools.length > PREVIEW_POOLS && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className={`chip ${styles.more}`}
        >
          {expanded ? "Show fewer" : `Show all ${safety.pools.length} pools`}
        </button>
      )}

      <div className={styles.notes}>
        <p>
          Percentages are shares of the <strong>measured</strong> liquidity
          {safety.coverage !== null ? ` (${pct(safety.coverage, 0)} of the total)` : ""}, not
          of the whole market. Burned liquidity is reported <em>inside</em> the locked
          figure rather than beside it — a pool that is 80% burned is 80% locked, not 160%.
        </p>
        <p>
          Locked counts only LP that provably cannot be redeemed: LP sent somewhere
          unspendable, or held in a frozen account. Custody by a lock program is shown
          separately, because the release schedule cannot be read generically and part of
          it may already be claimable.
        </p>
        {safety.notes.map((note, index) => (
          <p key={index}>{note}</p>
        ))}
      </div>
    </section>
  );
}

function PoolRow({ pool }: { pool: LiquiditySafetyPool }) {
  const unmeasured = pool.unmeasuredReason !== null;

  return (
    <li className={styles.pool} data-unmeasured={unmeasured ? "true" : "false"}>
      <div className={styles.poolBody}>
        <div className={styles.poolTop}>
          <span className={styles.dex}>{pool.dexId}</span>
          {pool.lpMint ? (
            <a
              href={explorerTokenUrl(pool.lpMint)}
              target="_blank"
              rel="noopener noreferrer"
              className={`font-mono ${styles.address}`}
              title="The pool's LP mint — the token whose supply this measurement is a share of."
            >
              LP {truncateAddress(pool.lpMint, 4)}
            </a>
          ) : (
            <span className={styles.notMeasured}>not measured</span>
          )}
        </div>
        <div className={styles.poolDetail}>
          {unmeasured ? (
            pool.unmeasuredReason
          ) : (
            <>
              {describe(pool)}
              {pool.holders[0]?.owner && (
                <>
                  {" · largest LP holder "}
                  <span className="font-mono">
                    {truncateAddress(pool.holders[0].owner, 4)}
                  </span>
                  {" ("}
                  <span title={CUSTODY_META[pool.holders[0].custody].note}>
                    {pool.holders[0].label ??
                      CUSTODY_META[pool.holders[0].custody].label.toLowerCase()}
                  </span>
                  {")"}
                </>
              )}
            </>
          )}
        </div>
      </div>
      <div className={`tnum ${styles.poolLiquidity}`}>{formatUsd(pool.liquidityUsd)}</div>
    </li>
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
    <div className={styles.metric} data-emphasis={emphasis ? "true" : "false"}>
      <div className={styles.metricLabel}>{label}</div>
      <div className={`tnum ${styles.metricValue}`}>{value}</div>
      <div className={styles.metricHint}>{hint}</div>
    </div>
  );
}

function Fact({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: string;
}) {
  return (
    <div className={styles.fact} title={note}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue} style={tone ? { color: tone } : undefined}>
        {value}
      </dd>
    </div>
  );
}

function describe(pool: LiquiditySafetyPool): string {
  const parts: string[] = [];
  if (pool.burnedFraction) parts.push(`${pct(pool.burnedFraction)} burned`);
  if (pool.frozenFraction) parts.push(`${pct(pool.frozenFraction)} frozen`);
  if (pool.lockCustodyFraction)
    parts.push(`${pct(pool.lockCustodyFraction)} in lock custody`);
  if (pool.withdrawableFraction)
    parts.push(`${pct(pool.withdrawableFraction)} withdrawable`);
  if (pool.unattributedFraction)
    parts.push(`${pct(pool.unattributedFraction)} not attributed`);
  return parts.length > 0 ? parts.join(", ") : "no LP supply outstanding";
}

/** A measured figure, or an explicit statement that there is none. */
function measure(fraction: number | null): string {
  return fraction === null ? "Not measured" : pct(fraction);
}

function subtract(total: number | null, part: number | null): number | null {
  if (total === null || part === null) return null;
  return Math.max(0, total - part);
}

function pct(fraction: number, digits = 2): string {
  if (fraction > 0 && fraction < 0.0001) return "<0.01%";
  return `${(fraction * 100).toFixed(digits)}%`;
}
