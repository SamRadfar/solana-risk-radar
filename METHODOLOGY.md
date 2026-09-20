# Risk Scoring Methodology

Solana Risk Radar produces a **deterministic, rule-based** risk score — never an LLM
guess. Every signal below is a pure function of on-chain / market data: same input,
same output, every time. This document is the full specification of that engine.
Source of truth: [`src/lib/risk-engine/`](src/lib/risk-engine/).

## What this tool is not

This score is **not** a prediction, and it is **not** financial advice. A low score
does not mean a token is "safe," and a high score does not mean it is a "scam." It
means: these specific, named, verifiable risk factors were or weren't observed. The
UI and this document never use the words "safe" or "scam" for that reason.

## How the score is computed

1. Seven independent rules each inspect the collected data and return a `RiskSignal`:
   a severity (`none` / `low` / `medium` / `high` / `critical`), a point contribution,
   the raw observed value, a plain-language explanation, and a machine-readable
   evidence blob the UI can display.
2. Each rule has a fixed **max point weight**. Weights sum to 100 across all seven
   rules.
3. If a rule's underlying data could not be fetched (e.g. an RPC method is rate
   limited), the rule reports `status: "unavailable"` and contributes 0 points —
   but its weight is also excluded from the denominator, so missing data can never
   silently make a token look artificially safe.
4. **Score = (points earned) / (weight of available rules) × 100**, rounded to the
   nearest integer.
5. If fewer than 40% of the total rule weight was available, the result is marked
   `Insufficient Data` instead of a numeric classification, regardless of the raw
   score — we would rather say "we don't know" than present a confident-looking
   number built on mostly missing data.

### Classification bands (0–100)

| Score | Classification |
|---|---|
| 0 – 19 | Low Risk Signals |
| 20 – 44 | Moderate Risk Signals |
| 45 – 69 | Elevated Risk Signals |
| 70 – 100 | High Risk Signals |

## The seven signals

### Authorities (35 pts)

**Mint Authority** (20 pts) — Is the SPL mint's `mintAuthority` still set?
An active mint authority means its holder can create new tokens at will, diluting
every existing holder at any time. Renouncing it (`null`) is a one-way, verifiable
on-chain action. Active → 20 pts (`high`). Renounced → 0 pts.

**Freeze Authority** (15 pts) — Is the SPL mint's `freezeAuthority` still set?
An active freeze authority can freeze any individual wallet's token account,
blocking that holder from ever selling or transferring. Active → 15 pts (`medium`).
Renounced → 0 pts.

*Note:* many legitimate, well-known tokens (e.g. centrally-issued stablecoins) keep
these authorities active by design, for compliance or upgrade reasons. This is
disclosed transparently — it is a fact about control, not automatically a verdict.

### Holders (30 pts)

**Largest Holder Concentration** (15 pts) — Percentage of total supply held by the
single largest token account (via `getTokenLargestAccounts`).

| Share of supply | Severity | Points |
|---|---|---|
| < 10% | none | 0 |
| 10–20% | low | 5 |
| 20–40% | medium | 10 |
| 40–70% | high | 13 |
| ≥ 70% | critical | 15 |

**Top 10 Holder Concentration** (15 pts) — Combined percentage of total supply held
by the ten largest token accounts.

| Share of supply | Severity | Points |
|---|---|---|
| < 20% | none | 0 |
| 20–40% | low | 5 |
| 40–60% | medium | 10 |
| 60–85% | high | 13 |
| ≥ 85% | critical | 15 |

*Known limitation:* the largest raw token accounts can include liquidity-pool
vaults, exchange hot wallets, or program-owned accounts — not necessarily an
individual "whale." We surface the raw figure and flag this caveat directly in the
UI; treat it alongside the evidence panel, not in isolation.

*Data availability:* Solana's public RPC endpoint throttles
`getTokenLargestAccounts` heavily. Both signals gracefully degrade to
`Unavailable` (0 pts, excluded from the score denominator) rather than failing the
whole report. See [README.md](README.md#improving-holder-data-reliability) to
enable this reliably.

### Liquidity (25 pts)

**Market Liquidity** (15 pts) — Total USD liquidity summed across every DEX pool
DexScreener indexes for the mint.

| Liquidity | Severity | Points |
|---|---|---|
| No pools found | critical | 15 |
| < $1,000 | critical | 15 |
| $1,000 – $10,000 | high | 11 |
| $10,000 – $50,000 | medium | 7 |
| $50,000 – $200,000 | low | 3 |
| ≥ $200,000 | none | 0 |

**Pool Maturity** (10 pts) — Age of the oldest known liquidity pool. New pools have
had no time to be stress-tested by the market.

| Pool age | Severity | Points |
|---|---|---|
| < 1 hour | critical | 10 |
| 1–24 hours | high | 7 |
| 1–7 days | medium | 4 |
| 7–30 days | low | 2 |
| ≥ 30 days | none | 0 |

### Market Activity (10 pts)

**Trading Activity** (10 pts) — Compares 24h volume to total liquidity ("turnover").

- Zero 24h volume despite an existing pool → `medium`, 5 pts ("dead market").
- Turnover > 10× liquidity → `medium`, 6 pts (possible wash trading).
- Turnover > 5× liquidity → `low`, 3 pts.
- Otherwise → `none`, 0 pts.

## Weight summary

| Category | Rules | Max points |
|---|---|---|
| Authorities | Mint Authority, Freeze Authority | 35 |
| Holders | Largest Holder, Top 10 Holders | 30 |
| Liquidity | Market Liquidity, Pool Maturity | 25 |
| Market Activity | Trading Activity | 10 |
| **Total** | | **100** |

## Deliberately out of scope for this MVP

- **Holder identity / labeling** (exchange vs. team vs. LP vs. retail) — would
  require a dedicated indexer or paid labeling API.
- **Contract / program-level risk** (SPL tokens have no custom bytecode to audit,
  unlike EVM ERC-20s, so this class of risk mostly doesn't apply on Solana).
- **Social / sentiment signals** — deliberately excluded; this tool only reports
  what can be verified from on-chain and market data, not opinion.
- **Historical holder trend** (e.g. whale accumulation over time) — would require
  time-series indexing beyond a stateless MVP.

These are natural next steps, not oversights — see [ARCHITECTURE.md](ARCHITECTURE.md)
for how the provider abstraction makes adding them straightforward.
