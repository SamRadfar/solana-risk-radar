# Market integrity v2

Algorithm/schema: `market-integrity-v2.6`. This layer changes measurement eligibility,
not risk bands, category weights, holder classification or authority rules.
Public market-data providers can be wrong, including in correlated ways. Agreement
is corroboration, not a guarantee of executable prices or independent upstream ownership.

## Pipeline and trust boundaries

Mint → separate DexScreener / GeckoTerminal snapshots → identity and orientation →
provider opinions → cross-provider validation → history contradiction check →
validated metrics → deterministic rules and UI.

Adapters preserve every returned pool, including rejected rows: provider, chain,
pool and DEX, requested/base/quote mint and symbols, requested side, original
native and USD fields, normalized USD, reserve/volume/change/trades, cap/FDV,
creation time, fetch time, provider update time when available, and public source URL.
An absent upstream update timestamp remains null; recent fetching cannot prove
recent trading or fresh upstream valuation. Provider token endpoints are also
retained. GeckoTerminal token price is selected from its top pool and is never
counted as an extra provider vote.

## Orientation and identity

Both token addresses and the Solana pool address must be valid, the requested mint
must occupy exactly one side, and the provider must establish the chain.
Trusted quote identity is an address registry, never a symbol or fixed dollar peg.

DexScreener reports base USD and base/quote native ratio. For a quote-side request:
requested USD = base USD / base-native ratio, only with proven identities and a
positive ratio. GeckoTerminal supplies both base and quote USD fields. Base-only
cap, FDV and 24h change are not transferred to the quote token. Trade directions
are reversed when the requested mint is quote.

OHLCV requests specify `currency=usd&token=<requested mint address>`. The response
must name that mint on exactly one side. Inverting base USD candles would produce
inverse dollars, not quote USD, so it is never used. Invalid/future/out-of-window
candles are removed; conflicting duplicate candles invalidate the series.

## Provider consensus and correlation

- Price selection never uses USD liquidity weights.
- A $250 reported reserve floor excludes dust/missing-depth pool observations.
  This is a limited eligibility filter, not proof of reserves or a voting weight.
- A pool with exactly zero reported 24h volume cannot establish current spot.
  Null volume is unknown, not zero. This is an eligibility decision, not an
  activity-risk threshold: independently corroborated zero volume can still
  drive the existing dormant-market rule when spot is established separately.
- When both token USD fields and a native ratio are supplied in one response,
  their conversion must be internally consistent within the existing 10%
  native tolerance. Consistency adds no vote; inconsistency rejects the row.
- All duplicate pool identities within a provider are quarantined. This is
  deterministic under permutation, including disagreeing duplicate rows.
- Group by provider plus counter-asset mint (the USD conversion dependency).
  Each group has one influence unit regardless of pools, DEX names or dollar depth.
- Compare the entire eligible price range within each group, then group medians.
  More than 10% multiplicative spread is unresolved conflict. Diagnostics also
  expose complete-range compatible clusters, with pool identities and distinct
  dependencies. A majority cannot discard a credible minority cluster. Invalid
  conversions and zero-volume quotations are excluded before forming clusters.
- When available, independently fetched counter-asset prices check
  requested-native-ratio × counter USD against reported requested USD (10% tolerance).
  A contradiction rejects that observation. Counter references are veto evidence,
  not extra votes, not replacement prices, and not guaranteed ground truth.
  References from the observation's own provider cannot validate that observation.
- A token endpoint and pools from one provider produce ONE provider opinion.
- Compare usable provider opinions, with one vote per unique provider ID.
  Any unresolved provider cluster conflict prevents canonical price publication.
  Another provider can be added via snapshots without rewriting risk rules.

## States and per-metric policy

| State | Meaning | Publish canonical value? |
|---|---|---|
| validated | At least two distinct provider opinions agree | Yes, for this metric only |
| single_source | One usable opinion; independent confirmation unavailable | No; a separately labelled indicative quote is displayed |
| conflict | Credible observations disagree | No |
| unavailable | No usable measurement | No |

Price uses an equal-provider median after agreement. There is no arbitrary winner
on disagreement and no liquidity tie-break. Price source values, candidate
clusters, exclusions, reasons and distances remain inspectable.

Market cap needs validated price AND at least two provider estimates of circulation.
Circulation estimates are derived from each provider's own cap/price, compared
within and between providers, and rejected above on-chain total supply plus the
existing 2% snapshot allowance. This is provider corroboration of circulation,
not an independent on-chain measurement; shared supply upstreams can still agree
incorrectly. GeckoTerminal may have no verified market cap. FDV is distinct:
validated price × on-chain total UI supply. FDV never substitutes for market cap.

24h change is separately compared as gross return (1 + percent/100), with 5%
multiplicative tolerance. Conflicting base-token returns or unavailable quote-side
returns remain withheld. If the provider-level comparison cannot validate (for
example one thin pool with a stale prior price makes a provider's own pools
disagree), a fallback uses SAME-POOL returns corroborated across providers (same
5% tolerance), takes their depth-weighted median, and publishes it only when the
pools agreeing with it hold a strict majority of corroborated reserves. Outlying
pools are disclosed. Providers disagreeing on the same pool never validate. Huge independently agreeing returns are permitted, not
clamped. UI and the volatility rule consume precisely this same measurement.
The four-hour chart does not validate a 24-hour return.

Reserves and volume are independently compared for IDENTICAL pool identities
across providers, rather than summing overlapping provider totals. Reserves have
25% tolerance; volume and buy/sell counts have 35%. Only matched corroborated
pools contribute, once. The published figure is a corroborated indexed subset,
not complete TVL or all trading volume. Missing fields never become measured zero.

**Metric-specific subsets (no all-or-nothing).** Each metric uses only the
corroborated pools with adequate evidence for THAT metric. A pool whose providers
disagree on (or lack) volume or trade counts is excluded from that metric only;
its reserves, identity, age and other metrics are unaffected. Volume and trade
counts are published only when the measured pools hold a strict majority of
corroborated reserves (a semantic majority, not tuned to test tokens), with
pools measured, reserve share and exclusions disclosed. Turnover divides the
subset's volume by the SAME subset's reserves, never a mixed set. Buy/sell balance
uses only pools where buys AND sells both validated. Pool Age needs corroborated
identity plus both providers' creation timestamps, not activity or returns.
Liquidity vs market cap stays unavailable when circulation cannot be corroborated.

**Pool-identity lookup.** Providers can list disjoint pool subsets for the same
token (USDC on 2026-09-27: zero overlap; GeckoTerminal's list was fake-token pools
reporting $4–9B reserves). When price validates but no pool is corroborated,
up to 30 DexScreener-listed pools are looked up on GeckoTerminal by address
(one request; skipped otherwise because GeckoTerminal rate-limits tightly).
Lookup rows pass every observation admission check, must agree with that
provider's own price consensus, and never vote on price, clusters, returns or
circulation. A pool listed by only one provider is still never counted.
These looser activity tolerances acknowledge asynchronous rolling windows; they
are policy allowances, not statistically calibrated accuracy guarantees.
Per-pool decisions preserve exclusions and each metric's status/source values.

Missing or conflicting market measurements produce unavailable risk signals,
excluded from numerator and denominator under the existing scoring method.
An empty corroborated subset cannot establish that a token has zero market
liquidity. Pool age uses corroborated pools and the fixed evaluation timestamp.
LP custody reads only corroborated reserves; holder/authority logic is unchanged.

## History, confidence and caching

History is fetched in server orchestration before scoring. A latest close no older
than 15 minutes is compared with spot using 5%. A contradiction invalidates spot,
cap, FDV, change, and associated market measurements, and is retained in diagnostics.
Unavailable history is not treated as confirmation. Fewer than six candles prevents
drawing a chart but a fresh identified close can still contradict spot.

Validated price is medium confidence by default. High requires tight provider
agreement (2%), tight internal dispersion, identified registry quotes at each
provider, no provider errors, and an independent native-ratio check. Single source
is low; unresolved/unavailable price is none. Neither pool count nor USD reserves
raise confidence alone.

Validation is pure with an explicit evaluation time. Fetch/known update timestamps
older than 90 seconds are ineligible. The report cache stays an in-process map
with 60-second TTL. Report/history keys include the algorithm version; HTTP
responses use private/no-store to avoid a browser retaining an old schema.
X-Cache and X-Market-Version distinguish cache hits and the algorithm. Diagnostics
retain evaluatedAt and original fetch timestamps even on a cache hit.

## Tolerance observation: 2026-09-27

A paced, keyless sample of both providers around 13:19–13:22 UTC found the following
differences between identified, ordinary quoted pools and the independent GT
token endpoint. This sample informed the 5% price tolerance; it does not prove
all tokens/venues always trade within that band.

| Token | DexScreener sample | GT token sample | Relative difference |
|---|---:|---:|---:|
| SOL | 122.65 | 122.6792998888 | 0.0239% |
| USDC | approximately 1.0000 after quote normalization | 1.0001337291 | approximately 0.0134% |
| JUP | 0.3359 | 0.33451068 | 0.4153% |
| BONK | 0.000003679 | 0.000003673963865 | 0.1371% |
| WIF | 0.2458 | 0.2445758189 | 0.5005% |
| PYUSD | 1.0002 | 1.0027056896 | 0.2505% |
| New token DiLre…pump | no eligible DS pool | 0.000003538608755 | unavailable |

The JUP, BONK and WIF responses ALSO contained materially inconsistent pools.
Those conflicting rows are not erased from validation merely because the
ordinary cluster agrees. The table is tolerance evidence, not a declaration that
these complete provider snapshots passed. The new-token sample honestly cannot
calibrate a spread. Early faster sampling returned 429s; slower requests succeeded.

Five percent is conservative relative to these observed ordinary differences
(maximum approximately 0.50%), allows asynchronous venue snapshots, and rejects
orders-of-magnitude errors. It is centrally named in policy.ts, symmetric
(max/min − 1), and boundary-tested. The 10% internal-cluster/native tolerance
allows heterogeneous pool timing but never decides which incompatible cluster
is correct. Revisit tolerances with broader recorded observations; do not tune
them to any particular token's desired result.

## Failure behavior, request budget and limits

DS, GT token and GT pools start concurrently. Then one bounded counter-token batch
(maximum 12 sorted distinct mints) is fetched; then, only when no pool could be
corroborated, one GT by-address pool lookup (maximum 30 pools); then at most one
history request.
Each request times out after eight seconds. An outage lowers coverage; it cannot
elevate another provider's credibility. No paid service, secret or environment
change is needed. Rate limits on shared public IPs can still reduce availability.

Two aggregators may share upstream valuations, token supply estimates or manipulated
venues. The application cannot prove full economic independence, full pool coverage,
actual executable depth, or historical accuracy. It does not perform an on-chain
reserve/oracle audit. Native checks are opportunistic and bounded; missing counter
references are disclosed, never invented. Conservative internal conflict handling
can withhold data for otherwise liquid tokens. That is intentional.

## Regressions and verification

The captured 30-pool JUP fixture is test-only. Its four corrupted pools carried
63.2863% of old aggregate weight without triggering any individual cap. Without
counter evidence the new validator returns conflict; with sufficient native
evidence it can reject the conversions. It never promotes the $1,638 cluster
because of aggregate weight.

The regression suite covers the requested A–R cases, provider identity and
opposite orientation, invalid numbers, dust, supply provenance, identical-pool
reserve/volume checks, duplicate/permutation stability, source counts, schema
version, history contradiction, return agreement, scoring exclusion and boundaries.
Legacy single-provider weighted-median expectations were replaced because they
asserted the failed trust policy. Existing risk-band and scoring calibration
expectations remain, except that no corroborated pools is now unmeasured rather
than proof of zero liquidity.

Run npm test, npm run typecheck, npm run lint, npm run build, npm run ui-check --
http://127.0.0.1:3450, and node scripts/market-audit.mjs http://127.0.0.1:3450.
The audit prints every state and fetches a fresh external token reference.
Unavailable external checks have a separate nonzero exit status; they are never
reported as an accuracy pass. Optional --providers-only runs the production
market service without RPC and explicitly has no on-chain supply for FDV.

References:
- https://docs.dexscreener.com/api/reference
- https://apiguide.geckoterminal.com/faq (token top-pool price; missing verified cap)
- https://apiguide.geckoterminal.com/changelogs (token-address OHLCV; native ratios)


## Phase 2 historical verification snapshot

On 2026-09-27, npm run verify passed: typecheck, lint, 234 tests in 13 files,
and the production build. The existing desktop/mobile UI smoke check also passed,
including explicit hero validation state, canonical-price consistency, withheld
valuations, converter gating, evidence controls, and no horizontal overflow.

The final full API audit (13:43–13:50 UTC) recorded:

| Token | Price state | Published price | External reference | Cap / FDV / 24h state |
|---|---|---:|---:|---|
| SOL | validated | 123.2142887924 | 123.4310056498 | conflict / unavailable / validated |
| USDC | validated | 1.0000 | 1.0003031485 | conflict / validated / single_source |
| JUP | conflict | withheld | 0.3350200247 | conflict / conflict / conflict |
| BONK | conflict | withheld | 0.000003681698012 | conflict / conflict / conflict |
| WIF | conflict | withheld | 0.2456235182 | conflict / conflict / conflict |
| PYUSD | validated | 0.9989971707 | 0.9984100974 | conflict / validated / validated |
| New token DiLre…pump | single_source | withheld | 0.000003471494328 | single_source / single_source / single_source |

Every additional external check ultimately returned HTTP 200; four required
one paced retry after 429. There were zero validation invariant failures.
Some production-path counter/history requests still returned 429 and remain
explicitly unavailable in diagnostics. External retry success is not retroactively
used to promote a report whose own evidence was insufficient.

An earlier full run (13:37 UTC) had the counter references needed to reject all
four inflated JUP conversions and validated approximately $0.337513, market cap
$1.1204B, FDV $2.3158B and 24h return −3.06%. The final run lacked that counter
evidence and withheld JUP instead. Both outcomes meet the integrity policy.
They are separate moving snapshots, not fixed expected token prices.

Final-source replay of all seven live diagnostic snapshots reproduced every
published metric/state. Public provider agreement remains limited evidence;
these checks do not certify executable prices, complete market coverage or
independent underlying feeds. No deployment is part of this verification.

## Phase 2.5 calibration and usability

The six-token baseline was collected before production edits on 2026-09-27,
14:13–14:19 UTC, from Phase 2 commit
`0b04fbfa04544e674a7a1465e8a089614cbd86e8`.

BONK's DexScreener pool `BuRGwvZuhdT4ihPysWYLPNMqXdiiJFNZBfPqSQ1MJ9jE`
reported $0.000004969, $7,605.64 reserves and exactly zero 24h volume.
WIF's `BuavWdfsNTfmEQbnPt2PLc51B7pifRNhqNiDUtGLeNNn` reported
$0.651, $6,550.05 reserves and zero volume. Both had nonzero tiny trade
counts, so counts alone did not prove meaningful current price discovery.
They passed the reserve floor and native checks, then vetoed their entire
provider's price range. Fetch timestamps were fresh; actual last-trade/update
timestamps were unavailable. Calling these prices *proven stale* would overstate
the evidence; they lack demonstrated current traded volume.

BONK's GeckoTerminal `HmQL6eECoaGLWvTxz6cWT3jEsPfjdin2vNVJ1xKiwjXz`
was a separate problem. The preserved raw fixture reports BONK USD
0.00002654348347, SAROS USD 0.0015858775105250337 and native BONK/SAROS
0.002315337761. Multiplication implies approximately 0.00000367184,
over seven times below reported BONK USD. This is a same-response conversion
contradiction, independent of pool count or depth. Actual upstream cause
(wrong field, stale conversion or manipulated pool) remains unknown.
A separate fresh pool read reproduced this inconsistency.

No spot (5%), cluster (10%), native (10%), cap, activity or risk-score
threshold was widened. No mint-specific exception was introduced.
Fixtures contain token identities solely as captured test evidence.

### Network availability and freshness

Identical concurrent HTTP reads share an in-flight promise. Completed responses
are removed immediately, so this adds no stale cache. Each endpoint has at most
two attempts, with 250–499ms jittered backoff; 429, 503 and network/timeout
failures may retry. Retry-After is respected: a delay exceeding 1.5 seconds is
returned as unavailable rather than retried early or blocking the request.
The existing eight-second timeout applies per attempt. Recovered failures remain
in diagnostics; a retry does not manufacture agreement.

Counter references remain a bounded, unique batch reused by the analysis.
A failed secondary token endpoint can coexist with a usable pool opinion.
Missing history, quote references, caps, depth or activity never become spot
contradictions by themselves. Unresolved incompatible observations still withhold
price; a 429 does not erase those observations either.

No last-known-valid fallback or persistent infrastructure was added. The existing
60-second report cache uses the new algorithm version and additionally checks
original market evidence against the 90-second freshness limit. It cannot extend
the age of provider/token/pool observations. A new conflict replaces the cached
result; no older validated value is substituted. During an ordinary cache hit,
no new upstream observation is made, so unseen changes remain unknown until a
new analysis. Open pages are snapshots, not streaming tickers.

### Display and scoring

Single-source quotes have a distinct `contextualQuote` envelope containing the
provider and exact fetch timestamp. The UI labels them indicative and unverified.
Canonical price, cap, FDV, converter and price-dependent risk evidence remain
withheld. Validated state and confidence are separate; medium confidence remains
a usable validated price. Market cap can be unverified while spot stays validated.

Cap estimates continue to use each provider's own cap/price circulation, never
FDV as a cap substitute. Cross-chain supply definitions and cached cap fields can
disagree; exact provider methodology is not derivable from these payloads.
On-chain total-supply bounds still apply. The UI therefore says Unverified rather
than presenting incompatible market caps as fact.

### Audit and regression coverage

`scripts/market-audit.mjs` defaults to SOL, USDC, JUP, BONK, WIF, PYUSD,
RAY, JTO, PYTH, SAROS (less liquid), and the captured newly listed mint.
It reports provider fetch differences, accepted-observation ages, individual risk
signal eligibility, per-metric states, nine-established-token usability percentages,
and median/p90/max gaps for validated established observations. This is a small
convenience sample, not a guarantee of provider accuracy or a statistical model
of all market conditions. The extra GeckoTerminal token read is a freshness check,
not a third independent provider.

The captured JUP regression was rerun after each eligibility/metric-policy change.
Tests also cover the preserved BONK/WIF raw responses, 429/timeout availability,
bounded retry/deduplication, secondary endpoint failure, cap/history independence,
tolerance boundaries, correlated pools, zero-activity preservation, cache freshness
and conflict replacement, contextual quote isolation, and UI state/metric gating.

### Phase 2.5 verification results (2026-09-27)

Final npm run verify passed: typecheck, lint, **253 tests in 14 files**, and
production build. The final built UI passed live and deterministic-state checks
at 1280×900 and 390×844, including the indicative hero quote and converter gate.

The eleven-token provider audit (14:22–14:36 UTC) validated eight of nine
established tokens (88.89%); RAY retained unresolved inflated clusters while
quote evidence was unavailable. Validated gaps: median 0.2655%, p90/max 0.5454%.
Fetch differences were 89–435ms, accepted observation ages 440–1,000ms.

The eleven-token full API audit (14:29–14:43 UTC) validated seven of nine
established tokens (77.78%); SOL was single-source (11.11%) during a GT outage,
and JUP retained incompatible clusters (11.11%). None was unavailable.
Validated gaps: median 0.1789%, p90/max 0.2992%.
The runs partially overlapped; public 429 responses are preserved as availability
events, and no later external response replaces a report's original inputs.

| Token | Full API spot | Price USD | Cap / FDV / 24h |
|---|---|---:|---|
| SOL | single_source / low | canonical withheld; indicative 122.093 | single / single / single |
| USDC | validated / high | 1 | conflict / validated / single |
| JUP | conflict / none | withheld | conflict / conflict / conflict |
| BONK | validated / medium | 0.0000037506487245 | validated / validated / validated |
| WIF | validated / medium | 0.2473248917 | validated / validated / conflict |
| PYUSD | validated / medium | 0.9991852570 | conflict / validated / validated |
| RAY | validated / high | 2.2103971850 | validated / validated / validated |
| JTO | validated / medium | 0.6244671636 | conflict / validated / conflict |
| PYTH | validated / medium | 0.0835652873 | validated / validated / conflict |
| SAROS | conflict / none | withheld | conflict / conflict / conflict |
| Newly listed sample | single_source / low | canonical withheld; indicative 0.000003471494328 | single / single / single |

Both audits had zero invariant failures and all external checks eventually
returned 200. Final-source replay reproduced all seven metric values/states
for all eleven captures in each audit. The captured JUP regression passed after
each major policy change. These results do not certify withheld prices, absence
of correlated upstream errors, or full market availability. No deployment.
