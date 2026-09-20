# Architecture

## Stack

| Choice | Why |
|---|---|
| **Next.js 16 (App Router)** | One deployable unit serving both the UI and the server-side data layer. Keeps provider access off the client without standing up a separate backend. |
| **TypeScript, strict** | The data layer parses untrusted JSON from three external sources; types are the cheapest place to catch shape drift. |
| **Tailwind CSS v4 + CSS variables** | Utilities for layout, design tokens in `globals.css` for the theme. No component framework — the UI is small enough that one would add more than it removes. |
| **Vitest** | The risk engine is pure functions; unit tests need no browser, no DOM and no network. |
| **No database** | There is no user state and no cross-request data worth persisting. The only shared state is a 60-second in-process report cache, which is an optimisation nothing depends on. |
| **No authentication** | The tool reads public chain data. There is nothing to protect and nobody to identify. |

Dependencies are deliberately few: `next`, `react`, and `@solana/web3.js` —
used only for `PublicKey` (program-derived address maths). RPC access is a
hand-rolled `fetch` client, because the requirement is endpoint failover and
tight timeouts rather than a full SDK.

---

## Request flow

```
Browser
  │  paste address → validated client-side (instant feedback)
  ▼
GET /api/analyze?address=…                     src/app/api/analyze/route.ts
  │
  ├─ validateMintAddress()                     re-validated: trust boundary
  ├─ cache hit? → return                       src/lib/cache.ts (60s TTL)
  │
  ├─ getMintInfo()                             ← gates everything below
  │
  ├─ Promise.all:
  │    ├─ getOnChainMetadata()   Metaplex PDA or Token-2022 extension
  │    ├─ getHolderData()        largest accounts → owners → classification
  │    ├─ getTokenAge()          bounded signature-history scan
  │    └─ getMarketData()        DexScreener
  │
  ├─ buildRiskReport()                         src/lib/risk-engine/engine.ts
  │    └─ 14 pure rules → signals → category roll-up → score
  ▼
RiskReport (JSON) → rendered by ReportView
```

The mint account is fetched first because it gates the rest: if the address is
not a token mint there is nothing to analyse, and its `decimals` and `supply`
are inputs to holder maths. Everything after it is independent and runs
concurrently.

---

## Module boundaries

```
src/
├── app/
│   ├── api/analyze/route.ts     orchestration + HTTP status mapping
│   ├── page.tsx                 view states: idle / loading / error / result
│   └── globals.css              design tokens
│
├── components/                  presentational; no data fetching
│   ├── ScoreGauge               hero figure + radial meter
│   ├── CategoryProfile          the risk-profile bar chart
│   ├── SignalCard               one rule's result + evidence
│   ├── DistributionPanel        classified holder table
│   ├── ReportView               composition + reading order
│   └── TokenInputForm           input + client-side validation
│
└── lib/
    ├── solana/                  ── on-chain reads (server-only) ──
    │   ├── address.ts           base58 + validation (isomorphic, no deps)
    │   ├── rpc.ts               JSON-RPC client, failover, retry, typed calls
    │   ├── mint.ts              mint account + Token-2022 extensions
    │   ├── metadata.ts          Metaplex borsh decode / T22 extension
    │   ├── holders.ts           largest accounts → owners → classification
    │   ├── age.ts               bounded history scan
    │   └── knownAddresses.ts    AMM / burn / custodian labels
    │
    ├── providers/
    │   └── dexscreener.ts       market data behind a provider-agnostic shape
    │
    ├── risk-engine/             ── pure, no I/O, no clock beyond Date.now ──
    │   ├── types.ts             the contract between data, engine and UI
    │   ├── input.ts             AnalysisInput — everything a rule may read
    │   ├── helpers.ts           severity→points mapping, threshold bands
    │   ├── rules/*.ts           14 rules, grouped by category
    │   └── engine.ts            runs rules, aggregates, classifies
    │
    ├── cache.ts                 in-process TTL cache
    ├── severity.ts              status palette + labels (UI-facing)
    └── format.ts                number/address formatting
```

The important line is between `lib/solana` + `lib/providers` (which do I/O and
may fail) and `lib/risk-engine` (which does neither). Rules receive a fully
materialised `AnalysisInput` and cannot make a network call, so scoring is
deterministic by construction rather than by discipline.

---

## Key decisions

### Provider abstraction sits at the data shape, not behind an interface

Rules depend on `MarketData`, never on DexScreener's wire format. Swapping in
GeckoTerminal or Birdeye means writing one function that returns `MarketData`;
no rule changes. A formal provider interface with a registry would be
ceremony for a single implementation — the seam is the type, which is enough.

### RPC endpoint failover, in priority order

`SOLANA_RPC_URL` (if set) → public endpoints known to serve
`getTokenLargestAccounts` → general-purpose fallbacks. Each endpoint gets up to
three attempts with backoff before the next is tried.

This exists because of a measured problem, not a theoretical one: **most free
Solana RPC endpoints, including `api.mainnet-beta.solana.com`, reject
`getTokenLargestAccounts` with HTTP 429 on essentially every request**, because
it scans a large slice of account state. Eleven endpoints were tested; the
default list contains ones that actually serve it. Without failover and retry,
holder concentration — a core requirement — would be permanently unavailable
with no configuration.

### Failure is per-signal, never per-report

Every data fetch degrades to an "unavailable" result internally rather than
throwing. One slow or rate-limited provider reduces coverage; it never fails the
analysis. The only hard failures are the ones where there is genuinely nothing
to report:

| Condition | Status |
|---|---|
| Malformed address | `400` |
| Account does not exist | `404` |
| Exists but is not a token mint (wallet, program, token account) | `422` |
| Mint account unreadable on every endpoint | `502` |

### Holder classification is two RPC round-trips, not N

`getTokenLargestAccounts` → one batched `getMultipleAccounts` to map token
accounts to owners → one more (with `dataSlice` to length 0, fetching headers
only) to find the program owning each owner. Two batched calls regardless of
holder count. Classification then works off program IDs, so a pool vault is
identified by *what owns it* rather than by an address allowlist that would rot.

### Security posture

- Every provider call is server-side. `SOLANA_RPC_URL` is never bundled into
  client code, and there is no `NEXT_PUBLIC_` variable anywhere.
- External responses are untrusted input: numeric fields are coerced and
  checked for finiteness, URLs from token metadata are parsed and restricted to
  `http`/`https` before rendering, and outbound links carry
  `rel="noopener noreferrer"`.
- Address validation runs on the server regardless of what the client did.
- The Metaplex borsh decoder bounds-checks its length prefixes, so a malformed
  metadata account cannot drive a huge read; it degrades to "no metadata".
- No secrets are required, so none can leak.

### Rendering

The page is a client component because the flow is interactive and
single-shot — paste, fetch, render. Server rendering the report would mean a
route per token and a slow navigation instead of a fast in-place update, for no
SEO benefit on a tool whose input is arbitrary. The report itself is plain
data, so moving it to a server component later is a small change.

---

## Testing strategy

| Layer | How | Command |
|---|---|---|
| Risk engine | Pure unit tests over synthetic inputs; every threshold boundary, both sides of two-sided rules, missing-data paths, aggregation invariants | `npm test` |
| Address validation | Unit tests including base58 edge cases | `npm test` |
| Full pipeline | Live probe against real mainnet tokens; asserts report invariants and error handling | `npm run probe` |
| UI | Headless Chromium at desktop and mobile widths; fails on console errors, page errors, horizontal overflow | `npm run ui-check` |

The split is deliberate. Scoring logic is deterministic and is tested for exact
values. Anything touching the network is verified for *shape and behaviour*,
never for specific numbers — real liquidity changes by the minute, and a test
asserting BONK's score would fail by tomorrow for no useful reason.
