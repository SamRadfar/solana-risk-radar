# Activity Intelligence v0.2 — observation only

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
3. Helius RPC `getTransactionsForAddress` per selected pool (at most three):
   `transactionDetails: "signatures"`, `sortOrder: desc`, `limit: 1000`, `commitment: finalized`,
   `filters.status: "succeeded"`, `filters.blockTime.gte/lte`. One request per pool, no pagination.
   Failed transactions are removed **server-side** and never cost parse, byte or record capacity
   (live: 54% of one busy JUP pool's recent signatures had failed). A listing entry that still
   reports an error is counted in `failedTransactions` and never fetched. Signatures are
   deduplicated across pools before any payload is fetched.
4. `POST https://mainnet.helius-rpc.com/v1/parsed-events/transactions?api-key=<key>`:
   `transactions: [signatures]`, `commitment: finalized`, `includeRawTransaction: true`.
   Newest-first, contiguous batches; the response must be an array matching the requested
   signatures one-to-one and in order.

If a pool's listing reaches 1,000 signatures, completeness is only proven above its oldest listed
slot. All pools are then analysed above that **common complete-listing frontier** only, so the
observed window is one contiguous slice for every selected pool.

Contract references: [Parsed Events](https://www.helius.dev/docs/parsed-events),
[parse transactions](https://www.helius.dev/docs/api-reference/parsed-events/transactions),
[getTransactionsForAddress](https://www.helius.dev/docs/rpc/gettransactionsforaddress) and
[rate limits](https://www.helius.dev/docs/billing/rate-limits).

## Hard acquisition bounds

Calibrated from live payloads (2026-09-27): a successful parsed record with raw transaction is
~15 KiB for a direct swap, 45–65 KiB for routed transactions, max 108.6 KiB observed; a listing
entry is ~225 bytes (1,000 signatures ≈ 220 KiB).

One hour requested; 1,000 successful signatures listed per pool; at most 500 parsed records
(after failure filtering and deduplication), in batches of at most 50; 20 total external requests
including discovery/RPC/listing (the plan needs at most 2 + 3 + 10); 15 seconds shared deadline;
6 MiB per response and 16 MiB per acquisition. Each batch is sized so that even at a 112 KiB
per-record ceiling it cannot overrun the per-response or remaining total byte cap; acquisition
stops cleanly instead of issuing a tail batch below 10 records. Parse requests are paced at
500 ms (the lowest documented Enhanced-API tier is 2 rps; unpaced live runs hit HTTP 429 after
~8 requests). Pacing is not retrying: there are still no retries, lifetime crawl, funding graph
or hidden fallback. Rate limits and timeouts remain acquisition failures, never market conflict
or malicious evidence.
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

### SOL transfers outside the swap root

System Program instructions outside the swap root are classified from raw instruction bytes and
account keys, never from decoded names. Only these are accepted, and each is recorded on the
action as `ancillarySolTransfers`:

- **zero-value**: a 0-lamport transfer (for example `jitodontfront` markers);
- **self-wrap**: a signer transfers into its own derived WSOL associated token account (Token or
  Token-2022, derived with the ATA program) and a later `sync_native` targets that account;
- **tip**: a signer transfers to a documented tip account (Jito's `getTipAccounts`, Helius Sender's
  published list) that takes no other role in the trade (not a swap-root, pool, balance or signer account).

Everything else that can move lamports (unknown recipients, including undocumented fee wallets and
tip services, non-signer sources, `transfer_with_seed`, a tip account with a trade role) remains an
unallocated transfer and the transaction is not interpreted. A self-wrap into a WSOL account that
persists across the transaction contaminates that account's WSOL balance delta, so its owner is not
`RESOLVED`. Native tips/wraps never enter token-balance deltas, so they do not change
requested-token amounts. Regression fixtures include minimized captured live envelopes.

### Controller resolution

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

Eligibility is assessed **per metric** (`metrics`) and ineligible feature groups are withheld (null):

- **Trader-independent** (`repeatedSizes`, `cadence`): basis is every normalized action. Requires
  at least 20 actions and 80% eligible-record parser coverage.
- **Trader-dependent** (`participants`, `concentration`, `cycling`, `inventory`): basis is the
  resolved-trader subset only. Requires the same gates **and** at least 20 actions in the resolved
  subset itself. Each metric discloses its sample size, action coverage and requested-token volume
  coverage. The former 80% resolution gate is removed rather than lowered: routed aggregator
  activity is structurally hard to attribute, so a sufficient resolved subset is reported as
  `PARTIAL` describing that subset, never as the whole market. Unresolved (often routed) activity
  can differ systematically from the resolved subset.

A metric is `MEASURED` only when its gates pass, the acquisition covered the full requested window
for every selected pool without errors or parse failures, and (for trader-dependent metrics) every
action was resolved. Otherwise an eligible metric is `PARTIAL` with reasons; below its gates it is
`INSUFFICIENT_DATA`. The overall `status` summarizes the metrics: `MEASURED` if all are,
`INSUFFICIENT_DATA` if none is eligible, otherwise `PARTIAL`. These are disclosed provisional
**data-quality gates**, not risk thresholds. Acquisition/configuration failure without
observations is `UNAVAILABLE`. Empty measured windows are insufficient
for interpretation; exhausting the resource budget before observations yields
`PARTIAL` with null features and an explicit stopping reason. Empty windows do not
mean zero risk. Features on partial/insufficient samples describe
only observed records; no population inference is made.

`successfulParses` counts accepted economic actions; `failedParses` counts
uninterpretable candidate records. Failed execution (filtered before fetching) and identified
non-swap/out-of-window exclusions are reported separately and excluded from the parser denominator.
`signaturesListed`, `signaturesNotFetched` and `bytesReceived` disclose how much of the listed
successful activity was actually examined.
`resolvedTraderCount` / `unresolvedTraderCount` count actions, not unique wallets;
unique buyers/sellers are separate features. Each normalized action retains a raw
reference, while the snapshot retains raw unparsed and excluded records too (failed transactions are not fetched).

## Storage, UI and verification

`ActivityStore` is a replaceable boundary. Its initial process-local implementation
holds four snapshots, reuses a result for 60 seconds, retains raw evidence up to
five minutes, and evicts oldest entries. Restart, eviction or another server
instance can remove evidence earlier. There is no durability/audit archive claim.
`GET /api/activity?address=<mint>&snapshot=<id>&signature=<signature>` retrieves a
raw envelope or returns 410 with an explicit explanation. Activity version/cache
remain separate from Market Integrity. Responses use private/no-store headers.

The collapsed, secondary panel loads only on expansion and shows requested/actual
span, data state, coverage, per-metric status and basis (withheld metrics show the reason),
features, pool scope, errors, limitations and JSON/raw references. No observation enters the scored report's data contract.

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify`,
and `npm run ui-check -- http://localhost:3000` against a local production build.
Activity tests use synthetic provider envelopes (plus minimized captured live envelopes for SOL
tip/wrap shapes) for ordinary trading, market making,
routing, repeated sizes, cycling, concentration, incomplete parsing/unresolved
owners, 1,000-record truncation, missing configuration, 429, duplicate/failed
transactions, multiple pools and legitimate arbitrage-like activity, plus boundary
tests. None are claims about live mainnet behavior.

Before wider use, capture authorized live Parsed Events responses for each supported
DEX and versioned/native-SOL route shape; evaluate parse/controller coverage and
request costs. Expand decoding only with raw evidence and deterministic regressions.
Durable persistence, global request quotas, historical graphs and scoring calibration
belong to later phases. Do not infer maliciousness from concentration/cycling alone.
