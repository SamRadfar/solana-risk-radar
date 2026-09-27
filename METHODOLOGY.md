# Risk scoring methodology

This document is the complete specification of how Risk Radar turns on-chain
and market data into a score. Every rule below is implemented as a pure
function in `src/lib/risk-engine/rules/`, and every threshold here is a literal
in that code.

**There is no model anywhere in this path.** No LLM, no training data, no
sampling, no randomness. Identical inputs always produce an identical score,
and a unit test asserts exactly that. The rationale sentence shown above each
report is assembled from measured thresholds, not written by a language model.

---

## 1. How a signal becomes points

Each rule owns a **weight** (its maximum contribution). A rule never invents a
point value: it maps its observed value onto a **severity** using a documented
threshold table, and the severity fixes what fraction of the weight is charged.

| Severity | Fraction of weight charged |
|---|---:|
| `none` | 0% |
| `low` | 25% |
| `medium` | 50% |
| `high` | 80% |
| `critical` | 100% |

Threshold tables are half-open — a value exactly on a boundary falls into the
*higher* band. This is asserted in the tests.

---

## 2. How points become a score

This is the part that was rebuilt, and the reasoning matters more than the
formula.

### The problem with a weighted average

The original engine summed every rule's points and divided by the total weight
of the measurable rules. That treats risk dimensions as **substitutes**:
renouncing the mint authority earns back the same points that having no
liquidity costs.

That is false, and it failed on real tokens. Measured against live mainnet
data, the old scoring produced:

| Token | Old score | Reality |
|---|---:|---|
| A token ~1 day old, $12K liquidity, one pool | **40** | Days old, nearly untradeable |
| USDT | **41** | Multi-billion-dollar stablecoin |

Across a sample of 18 tokens, the established group and the days-old group
**overlapped by 20 points** — the score could not separate them at all. Four
clean categories were arithmetically cancelling three compromised ones.

### The fix: aggregate over categories, non-compensatorily

Two changes.

**First, the unit of aggregation is the category, not the rule.** Each of the
five categories is normalised to 0–100% within itself, and categories are then
combined. This removes an accident of the old design: Authorities held 58 of
164 total weight simply because it has four rules, so a token that renounced
its authorities banked 35% of the entire score before anything else was
measured. Now a rule's weight only matters *relative to other rules in its own
category*, and adding a rule to one category cannot dilute another.

**Second, categories combine as a quadratic mean (root mean square), not an
arithmetic one:**

```
score = 100 × √( Σ wᵢ · rᵢ² / Σ wᵢ )
```

where `rᵢ` is category *i*'s risk ratio (0–1) and `wᵢ` its weight.

Geometrically this is the **normalised magnitude of the token's risk vector**
across five dimensions. Severe dimensions dominate; clean ones still pull the
result down, but can never fully cancel a severe one. Higher exponents (p = 3+)
collapse toward "worst category only" and discard the rest of the profile, so
p = 2 is the mildest exponent that makes the aggregation non-compensatory.

### What that guarantees

Because all five categories carry equal weight, the number of *fully
compromised dimensions* sets a floor on the score — a property pinned by test:

| Categories at 100% | Score | Classification |
|---:|---:|---|
| 1 | 45 | Elevated |
| 2 | 63 | High |
| 3 | 77 | High |
| 4 | 89 | Critical |
| 5 | 100 | Critical |

So **one compromised dimension can never on its own produce a "High" verdict,
and two always will.** That is a deliberate, stated property: a token with a
single severe flaw but genuine liquidity, a real history and renounced
authorities is a different animal from one that fails on three fronts.

### Category weights

All five are equal (20 each). Each is a distinct way to lose money — supply
inflated or seized (Authorities), dumped on you (Holders), impossible to exit
(Liquidity), a fabricated market (Market Activity), or no track record at all
(Maturity). None substitutes for another, and there is no defensible empirical
basis for ranking them, so none is privileged. Weighting is data, not code:
`CATEGORY_WEIGHTS` in `engine.ts`.

### Missing data

A rule that could not be evaluated is marked `unavailable`, charges **zero
points**, and its weight is **removed from the denominator**. If an entire
category is unmeasurable, that category drops out of the aggregation rather
than counting as clean.

Leaving missing data in the denominator would mean every failed fetch quietly
pushed a token toward "safe" — the worst possible failure direction for a risk
tool. A test asserts that an unmeasurable category scores *higher* than a
measured-clean one.

**Coverage** is reported separately:

```
coverage = measurable weight / total weight × 100
```

**Below 40% coverage the score is withheld** and the report is classified
`Insufficient Data`. Between 40% and 100% the verdict is labelled
"from partial data".

### Classification bands

| Score | Classification |
|---:|---|
| 0–19 | Low Risk Signals |
| 20–39 | Moderate Risk Signals |
| 40–59 | Elevated Risk Signals |
| 60–79 | High Risk Signals |
| 80–100 | Critical Risk Signals |
| — | Insufficient Data (coverage < 40%) |

These are labels for *how many signals fired and how hard*, not verdicts. A
"Low" token is not certified safe; it means these specific checks found little.

### Reference distribution

Bands were set against measured mainnet tokens, not round numbers. Sampled
values (market data moves, so these drift):

| Token | Score | Band |
|---|---:|---|
| Wrapped SOL | 5 | Low |
| BONK | 13 | Low |
| PENGU | 16 | Low |
| WIF | 19 | Low |
| JitoSOL | 21 | Moderate |
| TRUMP | 29 | Moderate |
| USDC | 32 | Moderate |
| JUP | 32 | Moderate |
| USDT | 39 | Moderate |
| PYUSD | 52 | Elevated |
| Recently launched tokens (n = 8) | 51 – 66 | Elevated / High |

Established tokens span **5–39**; tokens launched within days span **51–66**.
The **20-point overlap under the old scoring became a 12-point gap**, with no
established token scoring above any recently launched one.

Reproduce with `npm run probe`, or capture a fresh sample with
`node scripts/collect-calibration.mjs` and replay candidate aggregations
through `node scripts/evaluate-aggregation.mjs`.

---

## 3. Correlated signals: how holder concentration is handled

The two holder metrics needed restructuring, and the correlation is worth
stating plainly rather than hiding.

### The problem

The obvious pair — largest holder and top-10 holders — are not independent.
**Top-10 contains top-1.** Measured across 17 real tokens:

```
corr(top-1, top-10)  =  0.921
```

Scoring both charged the same wallet twice and reported it as two independent
findings. TRUMP is the clearest case: one wallet holds 72.7% and the top ten
hold 87.9%, which the old pairing reported as both a *critical single holder*
and *critical systemic distribution* — maxing the entire Holders category —
when the nine wallets behind the largest actually hold only 15.2% between them.
There was no cluster. There was one wallet, counted twice.

### The fix

The second rule now scores the **marginal** share: holders 2–10, with the
largest excluded.

```
corr(top-1, holders 2–10)  =  0.074
```

Effectively uncorrelated. The two rules now answer genuinely separate
questions:

| Rule | Question | Weight |
|---|---|---:|
| **Largest Holder** | Can one actor crash the price or exit ahead of everyone? | 18 |
| **Holder Spread** | Is there a cluster behind them that could act together? | 10 |

Two tokens with near-identical top-10 totals now score differently depending on
shape — a lone whale trips the first rule only, a bloc trips the second only.
A test pins exactly that.

**The familiar top-10 figure is still shown**, in both rules' evidence and in
the distribution panel. It is displayed, just not charged twice.

### Why concentration still cannot dominate

Three independent mechanisms, each tested:

1. The marginal metric stops one wallet being counted twice.
2. Holders is one category of five, normalised within itself.
3. The RMS caps any single category at 45 — below the High band.

So even a token where one wallet holds 95% of supply cannot reach "High" on
concentration alone. If that feels too lenient, note that the finding still
appears as `Largest Holder — 95% — Critical` at the top of Main Concerns; the
score summarises the profile, the concerns list surfaces the specific danger.

---

## 4. The rules

Total weight **162** across 14 rules in 5 categories. Remember that weights
matter only *within* a category.

### Authorities — 58 points across 4 rules

#### `mint-authority` — weight 20
| Observed | Severity |
|---|---|
| Renounced (`null`) | `none` |
| Active | `critical` |

The most consequential control a deployer can retain: unlimited new supply,
diluting every holder without warning. Note that fiat-backed stablecoins retain
it deliberately, which is why USDC and USDT carry a critical finding here. That
is the honest result — the issuer genuinely can mint at will.

#### `freeze-authority` — weight 14
| Observed | Severity |
|---|---|
| Renounced (`null`) | `none` |
| Active | `high` |

`high` rather than `critical` because regulated stablecoins hold it for
sanctions compliance — real unilateral control over your ability to exit, but
not automatically malicious.

#### `token-extensions` — weight 18
Token-2022 extensions granting ongoing control over transfers. Classic SPL
mints score `none`. Otherwise the **worst** finding sets the severity:

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

A permanent delegate is strictly more dangerous than a retained mint authority,
and is invisible to checkers that only look at mint and freeze authority.

#### `metadata-mutability` — weight 6
| Observed | Severity |
|---|---|
| Immutable | `none` |
| Mutable | `medium` |
| No metadata account | `unavailable` |

---

### Holders — 28 points across 2 rules

Concentration is measured over **sellable, circulating supply**. Each token
account is resolved to its owning wallet, and that wallet classified by the
program that owns *it*:

| Owner's owning program | Classified as | Counted? |
|---|---|---|
| A known AMM program | `pool` — liquidity vault | **Excluded** |
| A known burn address | `burn` | **Excluded**, and removed from the denominator |
| A known custodial exchange | `custodian` | Counted, flagged in the UI |
| Any other program / executable | `contract` — vesting, staking, escrow | Counted, flagged |
| System Program | `wallet` | Counted |

#### `top-holder` — weight 18
Largest single sellable holder's share of circulating supply.

| Share | Severity |
|---|---|
| < 5% | `none` |
| 5–10% | `low` |
| 10–20% | `medium` |
| 20–35% | `high` |
| ≥ 35% | `critical` |

#### `holder-spread` — weight 10
Combined share of the **2nd–10th** largest sellable holders.

| Share | Severity |
|---|---|
| < 20% | `none` |
| 20–35% | `low` |
| 35–50% | `medium` |
| 50–65% | `high` |
| ≥ 65% | `critical` |

Calibrated separately from the top-1 scale: nine wallets sharing 30% (~3.3%
each) is ordinary for a widely held token; nine sharing 65% is a bloc.

> **Limitation:** pool and burn shares are computed across the largest accounts
> examined, not the entire supply. Burns outside that set are missed, which
> slightly *understates* concentration. The UI states this.

---

### Liquidity — 32 points across 3 rules

#### `liquidity-depth` — weight 16
| Liquidity | Severity |
|---|---|
| ≥ $1M | `none` |
| $250k–$1M | `low` |
| $50k–$250k | `medium` |
| $10k–$50k | `high` |
| < $10k | `critical` |
| No independently corroborated pools | `unavailable` (not proof of zero liquidity) |

#### `liquidity-ratio` — weight 10
Liquidity as a share of market capitalisation.

| Ratio | Severity |
|---|---|
| ≥ 5% | `none` |
| 2–5% | `low` |
| 0.5–2% | `medium` |
| 0.1–0.5% | `high` |
| < 0.1% | `critical` |

**Then a depth ceiling is applied:**

| If total liquidity is… | Severity capped at |
|---|---|
| ≥ $5M | `low` |
| ≥ $1M | `medium` |

The raw ratio is actively misleading for large assets. USDC measures **0.06%**
— which the bands alone would call `critical` — while carrying tens of millions
of dollars of real depth that absorbs any realistic exit. The ratio is
structurally tiny for mega-caps because most supply was never pooled. The
question the rule exists to answer is "could holders actually exit?", so once
absolute depth is unambiguously sufficient, the relative measure is capped. The
UI shows when a cap was applied and what it changed.

#### `pool-diversity` — weight 6
Pools holding at least $1,000 of liquidity.

| Pools | Severity |
|---:|---|
| ≥ 3 | `none` |
| 2 | `low` |
| 1 | `medium` |
| 0 | `high` |

---

### Market Activity — 22 points across 3 rules

#### `trading-activity` — weight 10
24h volume relative to liquidity. **Deliberately two-sided:**

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
Absolute 24h price movement from the independently validated return shared with the UI.

| Movement | Severity |
|---|---|
| < 15% | `none` |
| 15–35% | `low` |
| 35–60% | `medium` |
| 60–85% | `high` |
| ≥ 85% | `critical` |

Absolute: +90% scores the same as −90%. Both indicate instability, and this is
not a price prediction.

---

### Maturity — 22 points across 2 rules

#### `pool-maturity` — weight 12
| Age | Severity |
|---|---|
| ≥ 180 days | `none` |
| 30–180 days | `low` |
| 7–30 days | `medium` |
| 1–7 days | `high` |
| < 1 day | `critical` |

#### `mint-age` — weight 10
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
history and resolves exactly — which is precisely the case that matters.

---

## 5. The summary layer

Everything above the fold is derived from the same signals that produced the
score:

- **Severity counts** — every signal falls into exactly one bucket
  (critical / high / medium / low / no concern / not measured). A test asserts
  the buckets total the signal count.
- **Main concerns** — the top three measured signals ranked by *points actually
  charged*, then severity, then weight. Ranking by contribution means the list
  is derived from the same arithmetic as the score, not curated separately. A
  clean signal is never listed as a concern.
- **Rationale** — one assembled sentence naming the categories driving the
  score (≥ 50% of their weight) and those offsetting it (≤ 15%), in the form
  *"Severe holder concentration and liquidity risk, partially offset by
  renounced authorities and an established track record."*

  The intensity word (Severe / Significant / Moderate) is taken from the worst
  *finding* inside the driving categories, not from the category percentage — a
  category can sit at 64% while containing a critical finding, and calling that
  "moderate" would contradict the signal shown directly beneath it.

---

## 6. Worked example

The token that motivated this rework: largest holder 37.29%, holders 2–10
43.31% (top 10: 80.60%), $12.6K liquidity in one pool, mint 1.2 days old, pool
4.7 days old, authorities renounced, trading otherwise normal.

| Category | Ratio | Findings |
|---|---:|---|
| Authorities | 0% | all renounced, metadata immutable |
| Holders | 82% | top-1 `critical`, spread `medium` |
| Liquidity | 65% | depth `high`, ratio `medium`, one pool `medium` |
| Market Activity | 7% | 24h move `low`, otherwise normal |
| Maturity | 89% | pool age `high`, mint age `critical` |

```
score = 100 × √((0.00² + 0.82² + 0.65² + 0.07² + 0.89²) / 5) = 62
```

A flat average of the same categories gives 49; the old signal-level average
gave 41. The difference is entirely the refusal to let two clean dimensions
cancel three compromised ones.

**62 → High Risk Signals**, versus **41 → Elevated** under the old flat
average. Rationale: *"Severe maturity risk, holder concentration and liquidity
risk, partially offset by renounced authorities and normal trading activity."*

For contrast, the all-red-flags archetype scores **90 → Critical**, and a
healthy blue chip **0 → Low**.

---

## 7. What this does not measure

Deliberately out of scope; no score should be read as covering it:

- **Contract logic in other programs** — vesting schedules, staking contracts
  and bridges are not inspected.
- **Off-chain reality** — team identity, promises, roadmap, audits, legal
  status.
- **Social signals** — follower counts and sentiment are trivially bought.
- **LP token custody** — whether LP tokens are locked or burned is not yet
  verified; `pool-diversity` is a partial proxy. The most valuable addition for
  a future version.
- **Historical behaviour** — prior rugs by the same deployer are not traced.
- **Price prediction** — the tool measures structural risk, never direction.

A token can pass every check here and still go to zero. The score describes
what was measured, and nothing else.


## Market measurement eligibility (v2)

Before any market rule runs, provider observations pass the [market integrity layer](docs/MARKET_INTEGRITY.md). Canonical prices require independent provider agreement. Correlated pool counts and USD liquidity cannot establish that agreement. Unverified/conflicting measurements are excluded from scoring; the severity bands and category weights above are unchanged. Liquidity/activity values refer to a corroborated indexed pool subset, not guaranteed complete market coverage. Historical calibration values above describe their original snapshots, not current validation availability.
