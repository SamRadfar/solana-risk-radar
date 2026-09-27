# Demo script

A three-minute walkthrough. The arc: *the number is fast, the reasoning is
auditable, and the tool is honest about what it doesn't know.*

**Before you start:** run `npm run dev`, open <http://localhost:3000>, and run
one analysis to warm the cache (results are cached for 60 seconds, so your demo
token will come back instantly). Have the four example chips visible.

---

## 0 · The problem (20 seconds)

> "Someone sends you a Solana token address. You have maybe thirty seconds to
> decide whether to look closer. Today that means four browser tabs — an
> explorer, a DEX aggregator, a holder list — and knowing which fields matter.
>
> Risk Radar is one box. Paste the address, get the structural risk signals, and
> see exactly where every one came from."

---

## 1 · The five-second read (30 seconds)

Click the **BONK** chip.

> "Real data — on-chain mint account, classified holder set, live market data.
> No API key, no account."

When the report lands, point at the gauge:

> "One number, a plain-English sentence telling you what it means, and how much
> of the analysis actually succeeded. That's the five-second read. Everything
> below is for when you want more."

Then the **category profile**:

> "Five categories. Authorities are clean — BONK renounced its mint and freeze
> authority, which is permanent and verifiable. The risk that exists is in
> holders and liquidity."

---

## 2 · Every number is auditable (45 seconds)

Scroll to **Flagged signals** and open **Inspect evidence** on a holder signal.

> "This is the core of it. Every signal tells you what was measured, what was
> found, how many points it contributed and why — and then opens onto the raw
> evidence, with links straight to the chain. Nothing in that score is a black
> box, and no language model had an opinion about it."

Scroll to **Holder distribution**:

> "And this is where most token checkers get it wrong. `getTokenLargestAccounts`
> returns token *accounts*, not people. A liquidity pool vault holding forty
> percent of supply is liquidity — that's good. A burn address holding forty
> percent is supply that no longer exists. Neither is a whale who can dump on
> you.
>
> Risk Radar resolves each account to its owner, then classifies that owner by
> the program that controls it. Pools and burns are excluded, exchanges are
> labelled, and concentration is measured over genuinely sellable supply. You
> can see every call it made and disagree with any of them."

---

## 3 · It finds what others miss (40 seconds)

Paste PYUSD's mint — `2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo`.

> "PayPal's stablecoin — and a Token-2022 mint, which is where it gets
> interesting."

Point at **Token-2022 Extensions**:

> "A permanent delegate. That means an authority can move this token out of any
> wallet, at any time, without the holder's consent. That is strictly more
> powerful than a mint authority, and a checker that only looks at mint and
> freeze authority shows you nothing here.
>
> It scores Elevated. Note what the tool does *not* say: it doesn't call PayPal
> a scam. Regulated issuers hold these controls deliberately. It reports that
> the control exists, explains what it enables, and lets you decide whether you
> accept it."

---

## 4 · Honest about its limits (30 seconds)

Scroll to **Could not be measured**.

> "Pool Age uses the oldest independently corroborated liquidity-pool timestamp.
> When that timestamp is missing, the signal says not measured and its weight
> is excluded from scoring. When it is measurable, its existing age bands apply.
>
> Missing data never makes a token look safer here. That's the whole design."

Click **USDC** if there's time:

> "And to show the scoring isn't cosmetic — USDC scores Moderate, because it has
> a live mint authority and a live freeze authority. That's not a bug. The
> issuer genuinely can mint at will and freeze your wallet. The tool reports
> what's true, even when the answer is inconvenient."

---

## 5 · Close (15 seconds)

> "Thirteen deterministic rules, every threshold published in METHODOLOGY.md.
> Same input, same score, every time. Next.js and TypeScript, no API keys, no
> database, deploys to Vercel in one command.
>
> It will never tell you a token is safe — it tells you what it measured, what
> it couldn't, and exactly how it got there."

---

## Backup notes

**If a lookup is slow.** Holder scanning genuinely takes a few seconds on public
RPC for very large tokens — the node is walking a large account set. Say so; it
is a real constraint, and setting `SOLANA_RPC_URL` to a free-tier endpoint fixes
it. Re-running a token inside 60 seconds is instant from cache.

**If holder data shows unavailable.** Free endpoints rate-limit
`getTokenLargestAccounts`. The report still renders, coverage drops, and the
score is normalised over what was measurable — which is itself a good thing to
demo if it happens. Pause a few seconds and retry.

**Good error-handling demos:** paste `abc` (inline validation, no request
sent), or a wallet address like
`9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM` (valid key, not a mint — a
specific, actionable message rather than a stack trace).

**Questions you'll get:**

- *"Does it use AI?"* No. Deterministic rules with published thresholds. That's
  the point — an LLM guessing "scam" is unfalsifiable and unauditable.
- *"Can it detect honeypots?"* Partially: non-transferable tokens, transfer
  hooks and default-frozen accounts are all flagged. It does not simulate a
  sell, which would catch more.
- *"What's missing?"* LP token lock/burn verification is the most valuable next
  addition, and it's listed as out of scope in METHODOLOGY.md rather than
  quietly omitted.
