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
          size={96}
          compact
        />
        <div className={styles.riskText}>
          <div className={styles.classification} style={{ color: meta.color }}>
            {CLASSIFICATION_SHORT[report.classification]} risk
          </div>
          <div className={styles.riskMeta}>
            {report.coveragePercent}% coverage
          </div>
          <div className={styles.riskMeta}>
            {totalSignals} signals checked
          </div>
        </div>
      </div>

      {/* ---- Market ---- */}
      <section className={styles.block} aria-label="Market snapshot">
        <div className={styles.eyebrowRow}>
          <span className="eyebrow">Market</span>
          {market.available && market.poolCount > 0 && (
            <span className={`tnum ${styles.note}`}>
              {market.poolCount} pool{market.poolCount === 1 ? "" : "s"}
            </span>
          )}
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
            wide
          />
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
              <dd className={styles.linkValue}>
                {socials.map((url) => (
                  <ExternalLink key={url} href={url} label={socialLabel(url)} />
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
            Links come from pool listing metadata and are not issuer-verified.
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

function Cell({
  label,
  value,
  wide,
}: {
  label: string;
  value: string | null;
  wide?: boolean;
}) {
  return (
    <div className={`${styles.cell} ${wide ? styles.cellWide : ""}`}>
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
 * Names a social link from its own hostname.
 *
 * This reads the URL the metadata pipeline returned — it never infers a
 * handle, constructs a profile URL, or assumes a project has an account
 * anywhere. An unrecognised host is shown as the host itself.
 */
function socialLabel(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url;
  }

  if (host === "x.com" || host === "twitter.com") return "X";
  if (host === "t.me" || host.endsWith("telegram.org")) return "Telegram";
  if (host.endsWith("discord.gg") || host.endsWith("discord.com")) return "Discord";
  if (host.endsWith("github.com")) return "GitHub";
  if (host.endsWith("reddit.com")) return "Reddit";
  if (host.endsWith("youtube.com") || host === "youtu.be") return "YouTube";
  if (host.endsWith("instagram.com")) return "Instagram";
  if (host.endsWith("tiktok.com")) return "TikTok";
  if (host.endsWith("medium.com")) return "Medium";
  if (host.endsWith("linkedin.com")) return "LinkedIn";
  return host;
}
