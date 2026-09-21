"use client";

import { useState } from "react";

import type { RiskReport, Severity } from "@/lib/risk-engine/types";
import {
  CLASSIFICATION_SHORT,
  SEVERITY_META,
  UNAVAILABLE_META,
  scoreMeta,
} from "@/lib/severity";
import { explorerTokenUrl } from "@/lib/solana/knownAddresses";
import { formatNumber, formatPrice, formatUsd, truncateAddress } from "@/lib/format";

import ScoreDial from "./ScoreDial";
import styles from "./TokenPanel.module.css";

/**
 * The token snapshot — one persistent panel describing whatever mint is
 * currently analysed.
 *
 * Every value is read from the report object for the analysed mint, so the
 * whole panel changes with the token and nothing in it is specific to any one
 * of them. Where the pipeline has no answer, the field says so rather than
 * showing a plausible number: a missing market cap is "Unavailable", missing
 * metadata means the website row is absent, and a missing price removes the
 * converter entirely.
 *
 * Three figures deliberately do not appear, because nothing in the pipeline
 * can establish them honestly: circulating supply (the mint reports total
 * supply only), max supply (SPL mints have no such concept) and holder count
 * (only the largest accounts are enumerable, not the full holder set).
 */
export default function TokenPanel({ report }: { report: RiskReport }) {
  const { overview, market, summary } = report;
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
  const totalSignals = counts.reduce((sum, entry) => sum + entry.value, 0);

  const websites = overview.websites.slice(0, 2);
  const socials = overview.socials.slice(0, 5);

  /*
   * FDV is suppressed when it comes back below the market cap, which is
   * definitionally impossible — fully diluted value includes the circulating
   * part. The aggregator does report this: for USDC every indexed pool says
   * market cap $60.9B and FDV $9.3B at the same time. The figure is wrong
   * rather than merely surprising, so it is withheld instead of printed.
   *
   * Applied here, at the point of display, rather than in the market provider:
   * this is a decision about what is fit to show, not a change to how the
   * pipeline aggregates.
   */
  const fdvIsCoherent =
    market.fullyDilutedUsd !== null &&
    (market.marketCapUsd === null || market.fullyDilutedUsd >= market.marketCapUsd);
  const fullyDiluted = fdvIsCoherent ? market.fullyDilutedUsd : null;

  return (
    <>
      {/* ---- Identity ---- */}
      <div className={styles.identity}>
        {overview.imageUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={overview.imageUrl} alt="" className={styles.logo} />
        )}
        <div className={styles.identityText}>
          <div className={styles.name} title={overview.name ?? undefined}>
            {overview.name ?? "Unnamed token"}
          </div>
          <div className={styles.symbolRow}>
            {symbol && <span className={`font-mono ${styles.symbol}`}>{symbol}</span>}
            <span className={styles.program}>{overview.tokenProgram}</span>
          </div>
        </div>
      </div>

      <div className={styles.addressRow}>
        <CopyAddress mint={overview.mint} />
      </div>

      {/* ---- Risk summary ---- */}
      <div className={styles.risk}>
        <ScoreDial
          score={report.score}
          classification={report.classification}
          size={78}
          compact
        />
        <div className={styles.riskText}>
          <div className={styles.classification} style={{ color: meta.color }}>
            {CLASSIFICATION_SHORT[report.classification]} risk
          </div>
          <div className={styles.riskMeta}>
            {report.coveragePercent}% coverage · {totalSignals} signals
          </div>
        </div>
      </div>

      {/* ---- Market ---- */}
      <section className={styles.block} aria-label="Market snapshot">
        <div className={styles.eyebrowRow}>
          <span className="eyebrow">Market</span>
        </div>

        <dl className={styles.pairs}>
          <Cell label="Price" value={market.priceUsd !== null ? formatPrice(market.priceUsd) : null} />
          <Cell label="24h" value={formatChange(market.priceChange24hPercent)} />

          <Cell
            label="Market cap"
            value={market.marketCapUsd !== null ? formatUsd(market.marketCapUsd) : null}
          />
          <Cell
            label="FDV"
            value={fullyDiluted !== null ? formatUsd(fullyDiluted) : null}
          />

          <Cell
            label="Liquidity"
            value={market.liquidityUsd !== null ? formatUsd(market.liquidityUsd) : null}
          />
          <Cell
            label="24h volume"
            value={market.volume24hUsd !== null ? formatUsd(market.volume24hUsd) : null}
          />

          <Cell
            label="Total supply"
            value={
              overview.supplyIsMeaningful
                ? `${formatNumber(overview.supplyUi)}${symbol ? ` ${symbol}` : ""}`
                : "0 (reported)"
            }
          />
          <Cell label="Pools" value={market.available ? String(market.poolCount) : null} />
        </dl>
      </section>

      {/* ---- Findings ---- */}
      <section className={styles.block} aria-label="Findings summary">
        <div className={styles.eyebrowRow}>
          <span className="eyebrow">Findings</span>
        </div>
        <ul className={styles.findings}>
          {counts.map(({ key, value }) => {
            const m = key === "unavailable" ? UNAVAILABLE_META : SEVERITY_META[key];
            const dim = value === 0;
            return (
              <li key={key} className={styles.finding}>
                <span
                  aria-hidden="true"
                  className={styles.findingGlyph}
                  style={{ color: dim ? "var(--ink-faint)" : m.color }}
                >
                  {m.glyph}
                </span>
                <span
                  className={`tnum ${styles.findingCount}`}
                  style={{ color: dim ? "var(--ink-faint)" : m.color }}
                >
                  {value}
                </span>
                <span className={styles.findingLabel}>{m.label}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ---- Token essentials ---- */}
      <section className={styles.block} aria-label="Token essentials">
        <div className={styles.eyebrowRow}>
          <span className="eyebrow">Token essentials</span>
        </div>

        <dl className={styles.links}>
          <div className={styles.linkRow}>
            <dt className={styles.linkLabel}>Website</dt>
            <dd className={styles.linkValue}>
              {websites.length > 0 ? (
                websites.map((url) => (
                  <ExternalLink key={url} href={url} label={hostOf(url)} />
                ))
              ) : (
                <span className={styles.unavailable}>Unavailable</span>
              )}
            </dd>
          </div>

          {/*
            Socials are only rendered when the metadata pipeline actually
            returned them. Nothing here is inferred from the token's name, and
            an empty result shows no icons rather than dead ones.
          */}
          {socials.length > 0 && (
            <div className={styles.linkRow}>
              <dt className={styles.linkLabel}>Socials</dt>
              <dd className={styles.linkValue + " " + styles.socialRow}>
                {socials.map((url) => (
                  <SocialLink key={url} href={url} />
                ))}
              </dd>
            </div>
          )}

          <div className={styles.linkRow}>
            <dt className={styles.linkLabel}>Explorer</dt>
            <dd className={styles.linkValue}>
              <ExternalLink href={explorerTokenUrl(overview.mint)} label="Solscan" />
            </dd>
          </div>

          <div className={styles.linkRow}>
            <dt className={styles.linkLabel}>Program</dt>
            <dd className={`font-mono ${styles.linkValue} ${styles.plain}`}>
              {overview.tokenProgram}
            </dd>
          </div>

          <div className={styles.linkRow}>
            <dt className={styles.linkLabel}>Metadata</dt>
            <dd className={`${styles.linkValue} ${styles.plain}`}>
              {METADATA_SOURCE[overview.metadataSource] ?? overview.metadataSource}
            </dd>
          </div>
        </dl>

        {/*
          Provenance, stated rather than implied. These links come from the
          pool's listing metadata, which is submitted by whoever created the
          pool — not verified by the token issuer. PayPal USD returns two
          unrelated social accounts this way. The product's whole claim is that
          it never presents unverified data as established, so the label says
          what this is instead of calling it "official".
        */}
        {(websites.length > 0 || socials.length > 0) && (
          <p className={styles.provenance}>
            Links come from pool listing metadata, not issuer-verified.
          </p>
        )}
      </section>

      {/* ---- Converter ---- */}
      {market.priceUsd !== null && <Converter price={market.priceUsd} symbol={symbol} />}
    </>
  );
}

/* -------------------------------------------------------------------------- */

const METADATA_SOURCE: Record<string, string> = {
  metaplex: "Metaplex account",
  token2022: "Token-2022 extension",
  none: "No metadata account",
};

function Cell({ label, value }: { label: string; value: string | null }) {
  return (
    <div className={styles.cell}>
      <dt className={styles.cellLabel}>{label}</dt>
      <dd className={`tnum ${styles.cellValue}`}>
        {value ?? <span className={styles.unavailable}>Unavailable</span>}
      </dd>
    </div>
  );
}

/**
 * Price change is shown with a direction glyph and neutral ink.
 *
 * The severity ramp is reserved for risk in this product, and a token being
 * down 4% today is not a risk signal — colouring it red would put it in the
 * same visual language as a critical finding.
 */
function formatChange(percent: number | null): string | null {
  if (percent === null) return null;
  const glyph = percent > 0 ? "▲" : percent < 0 ? "▼" : "·";
  return `${glyph} ${percent > 0 ? "+" : ""}${percent.toFixed(2)}%`;
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={styles.external}
      title={href}
    >
      {label}
      <span aria-hidden="true" className={styles.arrow}>
        ↗
      </span>
    </a>
  );
}

function CopyAddress({ mint }: { mint: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(mint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused outright. Say nothing rather than
      // claiming a copy that did not happen — the full address is in the
      // title and selectable either way.
    }
  };

  return (
    <button type="button" onClick={copy} className={styles.copy} title={mint}>
      <span className={`font-mono ${styles.copyAddress}`}>{truncateAddress(mint, 6)}</span>
      <span className={styles.copyAction}>
        {copied ? "Copied" : <span aria-hidden="true">⧉</span>}
      </span>
      <span className="sr-only">
        {copied ? "Mint address copied" : `Copy mint address ${mint}`}
      </span>
    </button>
  );
}

/**
 * Token → USD, using the report's own canonical price.
 *
 * It takes the price as a prop rather than fetching one, so the number it
 * converts with is by construction the same number shown as "Price" above.
 * All arithmetic is local; there is no request behind any keystroke.
 */
function Converter({ price, symbol }: { price: number; symbol: string | null }) {
  const unit = symbol ?? "Token";
  const [tokens, setTokens] = useState("1");
  const [usd, setUsd] = useState(() => trim(price));

  const onTokens = (value: string) => {
    setTokens(value);
    const amount = Number(value);
    setUsd(value.trim() === "" || !Number.isFinite(amount) ? "" : trim(amount * price));
  };

  const onUsd = (value: string) => {
    setUsd(value);
    const amount = Number(value);
    setTokens(value.trim() === "" || !Number.isFinite(amount) ? "" : trim(amount / price));
  };

  return (
    <section className={styles.block} aria-label="Token to USD converter">
      <div className={styles.eyebrowRow}>
        <span className="eyebrow">
          {unit} &rarr; USD
        </span>
        <span className={`tnum ${styles.note}`}>1 {unit} = {formatPrice(price)}</span>
      </div>

      <div className={styles.converter}>
        <label className={styles.field}>
          <span className="sr-only">Amount in {unit}</span>
          <input
            type="text"
            inputMode="decimal"
            value={tokens}
            onChange={(event) => onTokens(event.target.value)}
            className={`tnum font-mono ${styles.input}`}
          />
          <span className={styles.unit}>{unit}</span>
        </label>

        <span aria-hidden="true" className={styles.equals}>
          =
        </span>

        <label className={styles.field}>
          <span className="sr-only">Amount in US dollars</span>
          <span className={styles.prefix}>$</span>
          <input
            type="text"
            inputMode="decimal"
            value={usd}
            onChange={(event) => onUsd(event.target.value)}
            className={`tnum font-mono ${styles.input}`}
          />
        </label>
      </div>
    </section>
  );
}

/** Enough precision for a sub-cent token, without trailing noise. */
function trim(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (value === 0) return "0";
  const decimals = Math.abs(value) >= 1 ? 4 : 8;
  return String(Number(value.toFixed(decimals)));
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * A social link, shown as its platform's mark.
 *
 * The platform is identified from the URL's own hostname — nothing is inferred
 * from the token's name and no profile URL is ever constructed. A host with no
 * mark of its own keeps its hostname as the label and gets a plain link icon,
 * so an unrecognised platform is still honestly identified rather than dropped
 * or mislabelled as something it is not.
 *
 * Marks are inline paths, which is how every other icon in this project is
 * drawn: no icon dependency, no downloaded asset.
 */
function SocialLink({ href }: { href: string }) {
  const platform = platformFor(href);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={styles.social}
      aria-label={platform.name}
      title={platform.name}
    >
      <svg
        viewBox="0 0 24 24"
        width="15"
        height="15"
        aria-hidden="true"
        focusable="false"
        {...(platform.stroke
          ? {
              fill: "none",
              stroke: "currentColor",
              strokeWidth: 2,
              strokeLinecap: "round" as const,
              strokeLinejoin: "round" as const,
            }
          : { fill: "currentColor" })}
      >
        <path d={platform.path} />
      </svg>
    </a>
  );
}

interface Platform {
  name: string;
  path: string;
  /** Drawn rather than filled. */
  stroke?: boolean;
}

const X_MARK =
  "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z";

const TELEGRAM_MARK =
  "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z";

const DISCORD_MARK =
  "M20.317 4.369a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.331c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.332-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.332-.946 2.418-2.157 2.418z";

const GITHUB_MARK =
  "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12";

const YOUTUBE_MARK =
  "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z";

const LINK_MARK =
  "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71";

function platformFor(url: string): Platform {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return { name: "Link", path: LINK_MARK, stroke: true };
  }

  if (host === "x.com" || host === "twitter.com") return { name: "X", path: X_MARK };
  if (host === "t.me" || host.endsWith("telegram.org")) {
    return { name: "Telegram", path: TELEGRAM_MARK };
  }
  if (host.endsWith("discord.gg") || host.endsWith("discord.com")) {
    return { name: "Discord", path: DISCORD_MARK };
  }
  if (host.endsWith("github.com")) return { name: "GitHub", path: GITHUB_MARK };
  if (host.endsWith("youtube.com") || host === "youtu.be") {
    return { name: "YouTube", path: YOUTUBE_MARK };
  }

  // Unrecognised: the host is still the honest name for it.
  return { name: host, path: LINK_MARK, stroke: true };
}
