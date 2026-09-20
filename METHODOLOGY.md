# Risk scoring methodology

This document is the complete specification of how Risk Radar turns on-chain
and market data into a score. Nothing here is heuristic hand-waving: every rule
below is implemented as a pure function in `src/lib/risk-engine/rules/`, and
every threshold in this document is a literal in that code.

**There is no model anywhere in this path.** No LLM, no training data, no
sampling, no randomness. Identical inputs always produce an identical score, and
a unit test asserts exactly that.

---

## 1. How a signal becomes points

Each rule owns a **weight** (its maximum point contribution). A rule does not
invent a point value. It maps its observed value onto a **severity** using a
documented threshold table, and the severity determines what fraction of the
weight is charged:

| Severity | Fraction of weight charged |
|---|---:|
| `none` | 0% |
| `low` | 25% |
| `medium` | 50% |
| `high` | 80% |
| `critical` | 100% |

So the Mint Authority rule (weight 20) charges 20 points at `critical` and 0 at
`none`; the Largest Holder rule (weight 16) charges 8 at `medium`.

This indirection is deliberate: a rule's weight can be retuned without touching
its thresholds, and every rule charges points on the same scale.

Threshold tables are half-open intervals — a value exactly on a boundary falls
into the *higher* band. `classify(10, [[10, "none"], …])` returns the band after
`none`. This is asserted in the tests.

---

## 2. How points become a score

```
score = (sum of points charged) / (sum of weights of MEASURABLE rules) × 100
```

Rounded to the nearest integer. Higher means more risk.

The denominator is the key decision. A rule that could not be evaluated — the
RPC refused, the token has no indexed pool, the history was too long to scan —
is marked `unavailable`, charges **zero points**, and its weight is **removed
from the denominator**.

The alternative (leaving the weight in the denominator) would mean every
failed data fetch quietly pushed a token's score toward "safe", which is the
worst possible failure direction for a risk tool. Normalising over measurable
weight instead keeps a partially-measurable token comparable to a fully
measurable one, and surfaces the gap separately as **coverage**.

```
coverage = (measurable weight) / (total weight) × 100
```

**Below 40% coverage the score is withheld entirely** and the report is
classified `Insufficient Data`. Too little evidence produces no number rather
than a confident-looking one.

### Classification bands

| Score | Classification |
|---:|---|
| 0–14 | Low Risk Signals |
| 15–34 | Moderate Risk Signals |
| 35–59 | Elevated Risk Signals |
| 60–79 | High Risk Signals |
| 80–100 | Critical Risk Signals |
| — | Insufficient Data (coverage < 40%) |

These are labels for *how many signals fired and how hard*, not verdicts. A
"Low" token is not certified safe; it means these specific checks found little.

---

## 3. The rules

Total weight **164** across 14 rules in 5 categories.

### Authorities — weight 58

Who still controls the token after launch.

#### `mint-authority` — weight 20
Whether new supply can still be minted.

| Observed | Severity |
|---|---|
| Renounced (`null`) | `none` |
| Active | `critical` |

The single most consequential control a deployer can retain: unlimited new
supply, diluting every holder without warning. Scored `critical` on its own —
but note that fiat-backed stablecoins retain it deliberately, so this drives
USDC to a non-trivial score. That is the honest result, not a bug: USDC's issuer
genuinely can mint at will.

#### `freeze-authority` — weight 14
Whether individual holders can be frozen.

| Observed | Severity |
|---|---|
| Renounced (`null`) | `none` |
| Active | `high` |

The holder can freeze any wallet's token account, blocking that holder from
selling. `high` rather than `critical` because regulated stablecoins hold it for
sanctions compliance — real unilateral control over your ability to exit, but
not automatically malicious.

#### `token-extensions` — weight 18
Token-2022 extensions that grant ongoing control over transfers. Classic SPL
Token mints score `none` (no extension mechanism exists). Otherwise the **worst**
finding sets the severity:

| Extension | Severity |
|---|---|
| Permanent delegate | `critical` — can move or burn the token from any wallet, forever |
| Non-transferable | `critical` — can be received but never sold |
| Default account state = frozen | `critical` — new accounts start frozen |
| Transfer hook (with a program) | `high` — every transfer calls third-party code that can block it |
| Transfer fee ≥ 5% | `high` |
| Transfer fee > 0% | `medium` |
| Mint close authority | `medium` |
| None of the above | `none` |

These are invisible to checkers that only look at mint and freeze authority,
and a permanent delegate is strictly more dangerous than a retained mint
authority.

#### `metadata-mutability` — weight 6
Whether name, symbol and image can still be changed.

| Observed | Severity |
|---|---|
| Immutable | `none` |
| Mutable | `medium` |
| No metadata account | `unavailable` |

For Token-2022 metadata there is no explicit immutability flag; metadata is
mutable exactly while an update authority is set.

---

### Holders — weight 30

**Concentration is measured over sellable, circulating supply.** This is the
part most token checkers get wrong.

`getTokenLargestAccounts` returns token *accounts*, not people. Before scoring,
each account is resolved to its owning wallet, and that wallet is classified by
the program that owns **it**:

| Owner's owning program | Classified as | Counted? |
|---|---|---|
| A known AMM program | `pool` — a liquidity vault | **Excluded** |
| A known burn address | `burn` | **Excluded**, and removed from the denominator |
| A known custodial exchange | `custodian` | Counted, flagged in the UI |
| Any other program / executable | `contract` — vesting, staking, escrow | Counted, flagged |
| System Program | `wallet` | Counted |

Burned supply is subtracted from the denominator (it can never be sold), and the
remaining shares are rebased onto circulating supply.

> **Limitation, stated plainly:** pool and burn shares are computed across the
> largest accounts examined, not the entire supply. Burns outside that set are
> missed, which slightly *understates* concentration. The UI says so.

#### `top-holder` — weight 16
Largest single sellable holder's share of circulating supply.

| Share | Severity |
|---|---|
| < 5% | `none` |
| 5–10% | `low` |
| 10–20% | `medium` |
| 20–35% | `high` |
| ≥ 35% | `critical` |

#### `top10-holders` — weight 14
Ten largest sellable holders combined.

| Share | Severity |
|---|---|
| < 15% | `none` |
| 15–30% | `low` |
| 30–50% | `medium` |
| 50–70% | `high` |
| ≥ 70% | `critical` |

---

### Liquidity — weight 32

#### `liquidity-depth` — weight 16
Total USD liquidity across every indexed pool.

| Liquidity | Severity |
|---|---|
| ≥ $1M | `none` |
| $250k–$1M | `low` |
| $50k–$250k | `medium` |
| $10k–$50k | `high` |
| < $10k | `critical` |
| No pools found | `critical` |

#### `liquidity-ratio` — weight 10
Liquidity as a share of market capitalisation.

| Ratio | Severity |
|---|---|
| ≥ 5% | `none` |
| 2–5% | `low` |
| 0.5–2% | `medium` |
| 0.1–0.5% | `high` |
| < 0.1% | `critical` |

**Then a depth ceiling is applied**, and this matters:

| If total liquidity is… | Severity is capped at |
|---|---|
| ≥ $5M | `low` |
| ≥ $1M | `medium` |

The bands above were calibrated against real mainnet tokens, not round numbers,
and the ceiling exists because the raw ratio is actively misleading for large
assets. USDC measures **0.06%** — which the bands alone would call `critical`
— while carrying tens of millions of dollars of real depth that absorbs any
realistic exit. The ratio is structurally tiny for mega-caps because most
supply was never in a pool to begin with. The question the rule exists to
answer is "could holders actually exit?", so once absolute depth is
unambiguously sufficient, the relative measure is capped. The UI shows when a
cap was applied and what it changed.

#### `pool-diversity` — weight 6
Pools holding at least $1,000 of liquidity.

| Pools | Severity |
|---:|---|
| ≥ 3 | `none` |
| 2 | `low` |
| 1 | `medium` |
| 0 | `high` |

A single-pool market is the structure a liquidity rug-pull depends on.

---

### Market Activity — weight 22

#### `trading-activity` — weight 10
24h volume relative to liquidity (turnover). **Deliberately two-sided:**

| Turnover | Severity | Why |
|---|---|---|
| Zero volume | `high` | Dead market — no counterparty when you sell |
| < 0.01× | `high` | Effectively dormant |
| 0.01–0.05× | `medium` | Very thin |
| 0.05–10× | `none` | Normal |
| 10–30× | `medium` | Possible inflated volume |
| > 30× | `high` | Wash-trade shaped |

#### `trade-imbalance` — weight 6
Share of 24h trades that were sells. Requires **≥ 50 trades**; below that the
ratio is noise and the signal is `unavailable` rather than misleading.

| Sell share | Severity |
|---|---|
| ≤ 65% | `none` |
| 65–75% | `low` |
| 75–85% | `medium` |
| > 85% | `high` |

#### `price-volatility` — weight 6
Absolute 24h price movement, measured on the deepest pool.

| Movement | Severity |
|---|---|
| < 15% | `none` |
| 15–35% | `low` |
| 35–60% | `medium` |
| 60–85% | `high` |
| ≥ 85% | `critical` |

Absolute: a +90% move scores the same as −90%. Both indicate instability, and
this is not a price prediction.

---

### Maturity — weight 22

#### `pool-maturity` — weight 12
Age of the oldest liquidity pool.

| Age | Severity |
|---|---|
| ≥ 180 days | `none` |
| 30–180 days | `low` |
| 7–30 days | `medium` |
| 1–7 days | `high` |
| < 1 day | `critical` |

#### `mint-age` — weight 10
Age of the mint's earliest transaction.

| Age | Severity |
|---|---|
| ≥ 365 days | `none` |
| 90–365 days | `low` |
| 30–90 days | `medium` |
| 7–30 days | `high` |
| < 7 days | `critical` |

There is no RPC method returning "when was this account created", so signature
history is walked backwards. **If the scan limit is hit before reaching the
start of history, the signal is reported `unavailable`, not young.** The oldest
signature fetched would otherwise be mistaken for the creation date, branding
the busiest tokens on Solana as minutes old. A newly created token has a short
history and resolves exactly — which is precisely the case that matters. A
regression test pins this behaviour.

---

## 4. Worked example

A token with a live mint authority (20), live freeze authority (11.2), a
permanent delegate (18), mutable metadata (3), 60% top holder (16), 95% top-10
(14), $3k liquidity (16), a 0.008% ratio (10), one pool (3), 133× turnover
(8), 94% sells (4.8), −92% in 24h (6), a 2-hour-old pool (12) and a 12-hour-old
mint (10) charges **152 of 164** → score **93** → **Critical Risk Signals**.

A token with everything renounced, broad distribution, deep multi-pool
liquidity and a year-old market charges near zero → **Low Risk Signals**.

---

## 5. What this does not measure

Deliberately out of scope, and no score should be read as covering it:

- **Contract logic in other programs.** Vesting schedules, staking contracts and
  bridges are not inspected.
- **Off-chain reality.** Team identity, promises, roadmap, audits, legal status.
- **Social signals.** Follower counts and sentiment are trivially bought.
- **LP token custody.** Whether LP tokens are locked or burned is not yet
  verified; `pool-diversity` is a partial proxy. This is the most valuable
  addition for a future version.
- **Historical behaviour.** Prior rugs by the same deployer are not traced.
- **Price prediction.** The tool measures structural risk, never direction.

A token can pass every check here and still go to zero. The score describes
what was measured, and nothing else.
