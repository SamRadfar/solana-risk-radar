"use client";

import { useState } from "react";

import type { Distribution, DistributionHolder } from "@/lib/risk-engine/types";
import { explorerAccountUrl } from "@/lib/solana/knownAddresses";
import { formatNumber, truncateAddress } from "@/lib/format";

import Reveal from "./Reveal";
import SectionHead from "./SectionHead";
import styles from "./DistributionPanel.module.css";

/**
 * The supporting evidence behind the two holder signals.
 *
 * This is the panel that makes concentration auditable: it shows what each of
 * the largest accounts actually is, so a reader can see for themselves why a
 * pool vault or a burn address was not counted as a whale.
 *
 * Presented as an open visualisation rather than a card. The ranking bars are
 * the section — they run the full width of the column, and the four headline
 * figures above them are set as figures rather than boxed as tiles.
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
      <section id="distribution" className="anchor">
        <SectionHead eyebrow="Holders" title="Holder distribution" />
        <Reveal as="p" className={styles.absent}>
          {distribution.reason ??
            "Holder data could not be retrieved for this token, so concentration was excluded from the score."}
        </Reveal>
      </section>
    );
  }

  const visible = expanded
    ? distribution.holders
    : distribution.holders.slice(0, PREVIEW_COUNT);
  const kindsPresent = [...new Set(distribution.holders.map((h) => h.kind))];
  const maxShare = Math.max(...distribution.holders.map((h) => h.share), 0.0001);

  return (
    <section id="distribution" className="anchor">
      <SectionHead
        eyebrow="Holders"
        title="Holder distribution"
        caption="The largest token accounts, each classified — so pool vaults and burn addresses are not mistaken for holders who could sell."
        meta={<>{distribution.holders.length} largest accounts</>}
      />

      <Reveal className={styles.metrics}>
        <Metric
          label="Largest holder"
          value={distribution.topHolderShare !== null ? pct(distribution.topHolderShare) : "—"}
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
          hint={`across these ${distribution.holders.length}`}
        />
        <Metric
          label="Burned"
          value={pct(distribution.burnedShare)}
          hint={`across these ${distribution.holders.length}`}
        />
      </Reveal>

      <Reveal as="ol" className={styles.ranking}>
        {visible.map((holder, index) => {
          const meta = KIND_META[holder.kind];
          const address = holder.owner ?? holder.tokenAccount;
          const excluded = holder.kind === "pool" || holder.kind === "burn";

          return (
            <li key={holder.tokenAccount} className={styles.holder}>
              <span className={`tnum ${styles.rank}`}>{index + 1}</span>

              <div className={styles.holderBody}>
                <div className={styles.holderTop}>
                  <a
                    href={explorerAccountUrl(address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`font-mono ${styles.address}`}
                  >
                    {truncateAddress(address, 6)}
                  </a>
                  <span
                    className={styles.kind}
                    style={{
                      color: meta.tone,
                      borderColor: `${meta.tone}3d`,
                      background: `${meta.tone}12`,
                    }}
                    title={meta.note}
                  >
                    {holder.label ?? meta.label}
                  </span>
                  {excluded && <span className={styles.excluded}>not counted</span>}
                </div>

                <div className={styles.track}>
                  <span
                    className={styles.fill}
                    style={
                      {
                        // Scaled to the largest holder so small tails stay visible.
                        "--fill": Math.max(holder.share / maxShare, 0.015),
                        background: excluded
                          ? "rgba(255,255,255,0.16)"
                          : `linear-gradient(90deg, ${meta.tone}59, ${meta.tone})`,
                      } as React.CSSProperties
                    }
                  />
                </div>
              </div>

              <div className={styles.holderFigures}>
                <div className={`tnum ${styles.share}`}>{pct(holder.share)}</div>
                <div className={`tnum ${styles.amount}`}>{formatNumber(holder.amountUi)}</div>
              </div>
            </li>
          );
        })}
      </Reveal>

      {distribution.holders.length > PREVIEW_COUNT && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className={`chip ${styles.more}`}
        >
          {expanded ? "Show fewer" : `Show all ${distribution.holders.length} accounts`}
        </button>
      )}

      <div className={styles.notes}>
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
        <div className={styles.legend}>
          {kindsPresent.map((kind) => (
            <span key={kind} className={styles.legendItem}>
              <span
                aria-hidden="true"
                className={styles.legendDot}
                style={{ background: KIND_META[kind].tone }}
              />
              <span>{KIND_META[kind].label}</span>
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
    <div className={styles.metric} data-emphasis={emphasis ? "true" : "false"}>
      <div className={styles.metricLabel}>{label}</div>
      <div className={`tnum ${styles.metricValue}`}>{value}</div>
      <div className={styles.metricHint}>{hint}</div>
    </div>
  );
}

function pct(fraction: number): string {
  if (fraction > 0 && fraction < 0.0001) return "<0.01%";
  return `${(fraction * 100).toFixed(2)}%`;
}
