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

/**
 * Verified control attributes, as inline badges.
 *
 * Each badge is a statement this product can defend from an on-chain fact, and
 * its tooltip says exactly what that claim is — "Multisig" does not mean the
 * allocation is locked, and "Unknown" is about this product's certainty rather
 * than about the address. The badges reuse the existing kind-badge styling, so
 * the row stays a row.
 */
const ATTRIBUTE_META: Record<string, { label: string; tone: string; note: string }> = {
  burned: {
    label: "Burned",
    tone: "#6f778c",
    note: "Held at an address from which tokens cannot be recovered.",
  },
  "liquidity-pool": {
    label: "Liquidity pool",
    tone: "#38d6ec",
    note: "A DEX pool vault, verified by the program that owns it. Tradable liquidity, not a holder who can dump.",
  },
  exchange: {
    label: "Exchange",
    tone: "#a3c940",
    note: "A custodial exchange wallet from the verified address registry. It holds many customers' balances rather than one person's.",
  },
  "program-vault": {
    label: "Program / vault",
    tone: "#fab219",
    note: "Owned by an on-chain program rather than a wallet — a vault, escrow or staking account. No lock is implied.",
  },
  locked: {
    label: "Locked",
    tone: "#22c55e",
    note: "This token account is frozen, so the balance cannot be transferred. The mint's freeze authority can lift it.",
  },
  "lock-program": {
    label: "Lock / vesting program",
    tone: "#38d6ec",
    note: "Custodied by a known lock or vesting program. The release schedule could not be read, so none of this holding is treated as locked — part of it may already be claimable.",
  },
  multisig: {
    label: "Multisig",
    tone: "#8b5cf6",
    note: "Controlled by a multisig, so more than one signer is needed to move it. It can still be sold once enough signers agree.",
  },
  wallet: {
    label: "Wallet",
    tone: "#eef1f7",
    note: "An ordinary wallet owned by the System Program. These are the holders counted toward concentration.",
  },
  unknown: {
    label: "Unknown",
    tone: "#6f778c",
    note: "No further identity or control structure could be verified. It does not mean the address belongs to an individual.",
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
                  {/*
                    The verified control structure. Where nothing could be
                    established the row still carries an identity, so it is
                    never left bare.
                  */}
                  {(holder.attributes?.length
                    ? holder.attributes
                    : [holder.kind === "wallet" ? "wallet" : "unknown"]
                  ).map((attribute) => {
                    const info = ATTRIBUTE_META[attribute];
                    if (!info) return null;
                    const threshold = attribute === "multisig" ? holder.multisig : null;
                    return (
                      <span
                        key={attribute}
                        className={styles.kind}
                        style={{
                          color: info.tone,
                          borderColor: `${info.tone}3d`,
                          background: `${info.tone}12`,
                        }}
                        title={info.note}
                      >
                        {threshold
                          ? `Multisig ${threshold.threshold}/${threshold.signers}`
                          : attribute === "exchange" || attribute === "liquidity-pool"
                            ? (holder.label ?? info.label)
                            : info.label}
                      </span>
                    );
                  })}
                  {holder.accountCount > 1 && (
                    <span
                      className={styles.excluded}
                      title={`This owner's balance was aggregated from ${holder.accountCount} token accounts.`}
                    >
                      {holder.accountCount} accounts
                    </span>
                  )}
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
