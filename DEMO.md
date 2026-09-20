# Demo Script (~2 minutes)

**Hook (10s)**
"Every day, people paste a random Solana token address into a group chat and
ask 'is this safe?' There's no good, fast, honest way to answer that. Solana
Risk Radar gives you a real answer in seconds — built from real data, not
vibes."

**1. The problem token (40s)**
Paste a well-known meme/test token mint, or a thin/new token if you have one
handy. Point out, within the first 5 seconds of the page loading:
- the big score number and color,
- the risk-band label ("Elevated Risk Signals" etc.) — never "scam,"
- the "N/100 signal weight available" note, showing the tool is honest about
  what it could and couldn't check.

**2. Explain one high-severity signal (30s)**
Click into the **Mint Authority** or **Freeze Authority** card. Read the
plain-language explanation aloud, then click "Inspect evidence" to show the
raw on-chain authority address — this isn't a guess, it's the literal account
from the SPL mint.

**3. Show the trust-building details (25s)**
- Scroll to **Liquidity** and **Pool Maturity** — explain these come from
  DexScreener in real time.
- Point at the persistent "Not financial advice" disclaimer — the tool is
  designed to inform, not to tell people what to do.

**4. Contrast with a healthy token (15s)**
Click the "USDC" example chip. Show the score, and explicitly call out that
USDC still shows active mint/freeze authority (Circle controls it by design)
— proof the tool reports facts honestly even for the token everyone trusts,
rather than special-casing "known good" tokens.

**Close (10s)**
"No API keys, no signup, real data, explainable score. That's Solana Risk
Radar."

## Fallback if live network/APIs are flaky during the demo

Have a terminal ready with `curl http://localhost:3000/api/analyze?address=<mint>`
pre-typed for 2–3 tokens, in case a live paste-and-wait feels risky on
conference wifi. The JSON response is itself readable and demonstrates the
same signal/evidence structure.
