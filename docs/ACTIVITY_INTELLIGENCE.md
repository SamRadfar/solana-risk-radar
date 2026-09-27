# Activity Intelligence v0.1 — observation only

This separate evidence engine asks what recent activity looks like. It produces
no risk score, severity, human/bot estimate, manipulation verdict or hard reject.
The existing 13 scored signals, total weight 152, coverage denominator, category
aggregation and Market Integrity v2.5 are unchanged. Creator history is out of scope.

## Request path and configuration

Expand **Activity Intelligence** on a report to call
`GET /api/activity?address=<mint>`. The scored `/api/analyze` route does not wait
for or consume this request. The activity endpoint is server-only acquisition;
configure `HELIUS_API_KEY` in the server environment. Never use a `NEXT_PUBLIC_`
variable. Missing configuration returns `UNAVAILABLE`, null features and a precise
reason, without requesting providers. Authentication keys and transport URLs are
not included in results. No deployment/environment changes are made by this feature.

Acquisition, in order:

1. DexScreener `GET https://api.dexscreener.com/token-pairs/v1/solana/<mint>`
   discovers exact-mint pool candidates, deduplicated by address and ranked by
   reported liquidity. Its prices/volume/behavioral labels are not used here.
2. Helius Solana RPC `POST https://mainnet.helius-rpc.com/?api-key=<key>`:
   `getMultipleAccounts`, finalized, owner-only data slice, at most 20 candidates.
   Match pool owner to Raydium CPMM or Orca Whirlpool. This verifies program
   ownership, **not** the pool's full account layout/mint fields or liquidity.
3. `POST https://mainnet.helius-rpc.com/v1/parsed-events/transaction-history?api-key=<key>`:
   each selected pool address; `sortOrder: desc`, `commitment: finalized`,
   `includeRawTransaction: true`, `time.gte/lte` in Unix seconds, `limit <= 100`,
   optional `paginationToken`. Pages alternate across at most three pools.

The implementation uses the current Parsed Events API, not the legacy enhanced
transaction endpoint. Contract references: [quickstart](https://www.helius.dev/docs/parsed-events/quickstart)
and [response schema](https://www.helius.dev/docs/parsed-events/parsed-response).
Synthetic tests follow this documented shape; a credentialed live contract test
is still required before relying on real-world parser coverage.

## Hard acquisition bounds

One hour requested; at most 1,000 received records **including** duplicates and
failed transactions; 15 total external requests including discovery/RPC;
15 seconds shared deadline; 4 MiB per response and 12 MiB per acquisition.
No retries, lifetime crawl, funding graph or hidden fallback. Rate limits and
timeouts remain acquisition failures, never market conflict or malicious evidence.
At most two concurrent acquisitions per server instance; requests for the same
mint share work. This is not a distributed rate limiter or production abuse policy.

`observedWindow` is the first/last normalized action's block time; it is not a
claim of continuous one-hour coverage. `poolWindows.reachedWindowStart` means
the provider exhausted its time-filtered history, not independently proven
archive completeness. `poolsCovered` lists successfully queried pools, not every
venue trading the token. Selection/rate limits can bias all measured values.

## Normalization and controller resolution

Require successful execution, matching raw/parsed signature, slot and block time,
and complete one-to-one raw/parsed instruction indexes, programs, data and accounts.
Resolve loaded addresses for versioned transactions. Bind a supported swap to its
identified pool and verify the Anchor swap discriminator. Multiple swap roots or
separate economic transfers cannot be safely allocated and are excluded as parse
failures. CPI legs under a single root produce one `signature:root` economic action;
repeat retrieval across pages/pools is deduplicated by signature.

For `RESOLVED`, require exactly one signing token-account owner participating in
the root with opposing requested-token and quote deltas, exactly two changed token
assets, and complete stable pre/post owner/mint/decimal records. The fee payer is
never used as a substitute. Owner ambiguity yields `PARTIAL` or `UNRESOLVED` with
null trader address; provider root-summary amounts may be retained with explicit
provenance. Account controller does not establish beneficial owner or independent
person. Delegates, multisigs, newly created/closed accounts and native-SOL wrapping
often remain unresolved. Raw RPC data comes from the same Helius response; this
is consistency checking, not independent-provider transaction verification.

Use exact integer strings/BigInt. Reject unsafe JSON integers; never use float
`uiAmount`. Preserve quote raw amount, quote mint and decimals only when resolved.
Cross-record decimal disagreement withholds interpretation. Atomic same-asset
routes and zero-net atomic cycles are not reconstructed. Provider decoding is
still a dependency: this is not a full independent replay of all DEX programs.

## Measurements and data quality

- Unique resolved buy/sell addresses, not people.
- Top 1/5/10 trade and requested-token-volume shares over resolved sample actions.
  Every share carries exact numerator/denominator, resolved count/volume coverage,
  record count and actual number of addresses included (which may be below N).
  No USD conversion or unrelated token amounts are summed.
- Adjacent opposite-side observations per address; both directions, observed gaps
  and non-overlapping equal-size opposite-side pairs. Same-slot ambiguity is
  excluded from sequence inference. Gaps are not proven holding times/profit.
- Gross token activity and net **swap flow** per resolved address. Actual inventory
  change is null because transfers outside selected-pool activity are not collected.
- Exact size repetition grouped by mint, decimals and side after deduplication.
  Preset UI sizes, round SOL amounts, arbitrage and market making can repeat sizes.
- Cadence in block-time seconds across different slots; no intra-slot ordering claim.

`MEASURED` means eligibility in the selected-pool sample: at least 20 actions,
80% eligible-record parsing and 80% resolved actions, with no recorded gaps.
These are disclosed provisional **data-quality gates**, not risk thresholds.
Above those gates, truncation/provider errors/partial parsing or resolution yield
`PARTIAL`. Below them, `INSUFFICIENT_DATA`. Acquisition/configuration failure
without observations is `UNAVAILABLE`. Empty measured windows are insufficient
for interpretation; exhausting the resource budget before observations yields
`PARTIAL` with null features and an explicit stopping reason. Empty windows do not
mean zero risk. Features on partial/insufficient samples describe
only observed records; no population inference is made.

`successfulParses` counts accepted economic actions; `failedParses` counts
uninterpretable candidate records. Failed execution and identified non-swap/out-of-
window exclusions are reported separately and excluded from the parser denominator.
`resolvedTraderCount` / `unresolvedTraderCount` count actions, not unique wallets;
unique buyers/sellers are separate features. Each normalized action retains a raw
reference, while the snapshot retains raw failed and excluded records too.

## Storage, UI and verification

`ActivityStore` is a replaceable boundary. Its initial process-local implementation
holds four snapshots, reuses a result for 60 seconds, retains raw evidence up to
five minutes, and evicts oldest entries. Restart, eviction or another server
instance can remove evidence earlier. There is no durability/audit archive claim.
`GET /api/activity?address=<mint>&snapshot=<id>&signature=<signature>` retrieves a
raw envelope or returns 410 with an explicit explanation. Activity version/cache
remain separate from Market Integrity. Responses use private/no-store headers.

The collapsed, secondary panel loads only on expansion and shows requested/actual
span, data state, coverage, features, pool scope, errors, limitations and JSON/raw
references. No observation enters the scored report's data contract.

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify`,
and `npm run ui-check -- http://localhost:3000` against a local production build.
Activity tests use synthetic provider envelopes for ordinary trading, market making,
routing, repeated sizes, cycling, concentration, incomplete parsing/unresolved
owners, 1,000-record truncation, missing configuration, 429, duplicate/failed
transactions, multiple pools and legitimate arbitrage-like activity, plus boundary
tests. None are claims about live mainnet behavior.

Before wider use, capture authorized live Parsed Events responses for each supported
DEX and versioned/native-SOL route shape; evaluate parse/controller coverage and
request costs. Expand decoding only with raw evidence and deterministic regressions.
Durable persistence, global request quotas, historical graphs and scoring calibration
belong to later phases. Do not infer maliciousness from concentration/cycling alone.
