# Architecture

## Stack

- **Next.js 16** (App Router, TypeScript, React 19) — one deployable app; API
  routes double as the backend, no separate server.
- **Tailwind CSS v4** — utility-first styling, dark analytical theme.
- **@solana/web3.js** — RPC client for on-chain reads.
- No database. No auth. No queue/worker. Every analysis is a stateless,
  on-demand fetch — there is nothing here that a hackathon MVP needs
  persistence for, and adding it would be complexity with no product benefit.

## Request flow

```
Browser
  │  GET /api/analyze?address=<mint>
  ▼
Next.js API route (src/app/api/analyze/route.ts)
  │
  ├─ validateSolanaAddress()            base58 / PublicKey sanity check
  │
  ├─ getMintInfo(mint)                  Solana RPC: getParsedAccountInfo
  │     ├─ decimals, supply
  │     ├─ mintAuthority, freezeAuthority
  │     └─ throws NotAMintError / AccountNotFoundError for bad input
  │
  ├─ (parallel) ──────────────────────────────────────────────
  │   ├─ getOnChainMetadata(mint)       Solana RPC: getAccountInfo on the
  │   │                                 Metaplex Token Metadata PDA, decoded
  │   │                                 by a minimal hand-rolled borsh reader
  │   │                                 (no API key, works even for unlisted
  │   │                                 tokens with no DEX pool)
  │   ├─ getHolderData(mint, supply)    Solana RPC: getTokenLargestAccounts
  │   │                                 (degrades to "unavailable" on failure
  │   │                                 instead of failing the request)
  │   └─ getMarketData(mint)            DexScreener public API: liquidity,
  │                                     volume, price, pool age, per pool
  │
  ▼
buildRiskReport()                       runs the 7 deterministic rules,
                                         aggregates the score (see
                                         METHODOLOGY.md), returns RiskReport
  ▼
JSON response → React UI renders score gauge, signal cards, evidence panels
```

Every external call has a timeout (10–12s) so one slow provider can't hang the
whole request. Provider failures degrade the relevant signal(s) to
`unavailable` rather than failing the entire report — a partial, honest answer
beats a hard error for every signal.

## Directory layout

```
src/
  app/
    page.tsx              client UI: input, loading/error/result states
    layout.tsx             fonts, metadata
    api/analyze/route.ts    the one API endpoint
  components/               presentational React components
  lib/
    solana/
      connection.ts         shared RPC client, env-configurable
      validate.ts            address validation
      mint.ts                 mint account fetch + parse
      metadata.ts             on-chain Metaplex metadata parser
      holders.ts               getTokenLargestAccounts wrapper
    providers/
      dexscreener.ts         market data provider (liquidity/volume/price)
    risk-engine/
      types.ts                RiskSignal / RiskReport contracts
      input.ts                 AnalysisInput contract (what rules consume)
      engine.ts                 aggregator: runs rules, computes score
      rules/*.ts                 one file per deterministic rule
    format.ts, severity.ts     display helpers
```

## Why these boundaries

**Providers are isolated behind small modules with a fixed return shape**
(`MarketData`, `MintInfo`, `HolderData`, `OnChainMetadata`). A rule never calls
`fetch` or the RPC client directly — it only reads these typed shapes. This
means:

- DexScreener can be swapped for Birdeye/GeckoTerminal/CoinGecko by rewriting
  `providers/dexscreener.ts` alone; nothing in `risk-engine/` changes.
- The RPC endpoint is a single env var (`SOLANA_RPC_URL`); swapping the public
  endpoint for Helius/QuickNode/Alchemy requires no code changes.
- Each rule is independently unit-testable with a synthetic `AnalysisInput` —
  no network calls required to verify scoring logic (see the "Testing"
  section in README.md).

**The engine never trusts a rule's weight unconditionally.** `buildRiskReport`
computes the score over only the *available* weight, and separately reports
`availableWeight`/`totalWeight` so the UI can show "70/100 signal weight
available" — an honest signal that the number itself is only ever as
confident as the data behind it.

## Data sources and why they were chosen

| Data | Source | Why |
|---|---|---|
| Mint/freeze authority, supply, decimals | Solana RPC `getParsedAccountInfo` | Ground truth, no API key, always available |
| Token name/symbol/URI | On-chain Metaplex Token Metadata PDA (hand-parsed borsh) | No API key; works even for tokens with zero DEX listings, unlike aggregator APIs |
| Holder concentration | Solana RPC `getTokenLargestAccounts` | Ground truth; only on-chain source for this without an indexer |
| Liquidity, volume, price, pool age | [DexScreener public API](https://docs.dexscreener.com/api/reference) | Free, no key, covers every major Solana DEX, keyed directly by mint address |

No paid service is used or required. See README.md for how to optionally add a
dedicated RPC provider's free tier for more reliable holder data.

## Known constraint: public RPC throttling

Solana's public mainnet RPC endpoint (the zero-setup default) aggressively
rate-limits `getTokenLargestAccounts` specifically — this was confirmed during
development, independent of overall request volume. Rather than let this
occasionally fail the whole analysis, `getHolderData` catches the failure and
reports the two holder-concentration signals as `unavailable`, which the
scoring engine then excludes from both the numerator and denominator (see
METHODOLOGY.md). The fix is operational, not architectural: point
`SOLANA_RPC_URL` at a dedicated free-tier RPC provider.
