# Solana Risk Radar

**Paste any Solana token address and understand its major risk signals within
seconds.**

Built for the Superteam Germany **Road to Colosseum Hackathon**.

Solana Risk Radar pulls real on-chain and market data for any SPL token mint,
runs it through a transparent, deterministic scoring engine, and shows you
exactly which signals — mint authority, freeze authority, holder
concentration, liquidity, pool age, trading activity — drove the result. No
LLM guesses whether a token is a "scam." Every number is explainable and
backed by inspectable evidence.

> **Not financial advice.** This tool reports verifiable risk factors. It
> never claims a token is "safe" or a "scam."

## Quick start

Requirements: Node.js 20+.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and paste a Solana token
mint address (or click one of the example chips). That's it — **no API keys
or accounts are required to run this app.** It works out of the box against
Solana's public RPC endpoint and DexScreener's free public API.

### Improving holder-data reliability

Solana's public RPC endpoint aggressively rate-limits the specific method
used for holder-concentration analysis (`getTokenLargestAccounts`). The app
handles this gracefully — it marks those two signals "Unavailable" and
excludes them from the score rather than failing the whole report — but for
consistently reliable holder data, sign up for a **free** RPC provider tier
(no cost, ~2 minutes) and set it in `.env.local`:

```bash
cp .env.example .env.local
# then edit .env.local:
SOLANA_RPC_URL=https://your-endpoint-from-helius-or-quicknode-or-alchemy
```

Good free-tier options: [Helius](https://helius.dev), [QuickNode](https://quicknode.com),
[Alchemy](https://alchemy.com). No code changes needed — the app reads this
one environment variable.

## Scripts

```bash
npm run dev      # start the dev server
npm run build    # production build
npm run start    # run the production build
npm run lint     # eslint
npx tsc --noEmit # type-check
```

## Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — stack, request flow, module
  boundaries, and why they're drawn where they are.
- [`METHODOLOGY.md`](METHODOLOGY.md) — the full, exact specification of every
  risk rule: thresholds, point weights, and how the overall score is
  computed.
- [`DEMO.md`](DEMO.md) — a short walkthrough script for presenting the
  project.

## How it works, in short

1. You paste a mint address.
2. The app validates it and fetches, in parallel:
   - the SPL mint account (supply, decimals, mint/freeze authority) via
     Solana RPC,
   - on-chain Metaplex token metadata (name/symbol), parsed directly with no
     API key,
   - holder concentration via `getTokenLargestAccounts`,
   - liquidity/volume/price/pool-age via [DexScreener](https://dexscreener.com)'s
     free public API.
3. Seven deterministic rules score the token (see `METHODOLOGY.md`) and
   return a 0–100 score, a risk-band classification, and per-signal
   explanations with raw evidence.
4. The UI shows the score first (readable in ~5 seconds), then lets you
   expand any signal to see exactly what data produced it.

## Testing

Rule logic is pure and side-effect-free — each rule is a function of a typed
`AnalysisInput` to a `RiskSignal`, independently testable with synthetic
inputs (no network calls required). During development this was verified
against synthetic "no liquidity pool," "brand-new pool," and "healthy mature
pool" scenarios, plus manually against multiple real mainnet tokens across
categories:

| Token | What it checks |
|---|---|
| USDC | mainstream, active mint/freeze authority (issuer-controlled by design), deep liquidity |
| Wrapped SOL | Solana's native mint quirk (`supply` always reports `0` on-chain) |
| BONK | renounced authorities, deep liquidity, healthy trading |
| PYUSD | Token-2022 program path (not just legacy SPL Token) |
| invalid strings / non-mint accounts / nonexistent accounts | error handling |

The UI was also driven end-to-end with Playwright (desktop + mobile
viewports) to confirm no console errors and correct rendering at each state
(loading, result, evidence expansion).

## Deployment

This is a standard Next.js app — deploy it anywhere Next.js runs. The
fastest path is [Vercel](https://vercel.com):

```bash
npx vercel
```

Set `SOLANA_RPC_URL` as an environment variable in your hosting provider's
dashboard if you want reliable holder data (optional — the app works without
it). No other environment variables or secrets are required.

## Project description (hackathon submission)

**Solana Risk Radar** is a token risk-analysis tool for the Solana ecosystem.
Paste a mint address and get a deterministic, explainable risk score in
seconds — backed by real on-chain data (mint/freeze authority, holder
concentration) and real market data (liquidity, pool age, trading activity),
never by an LLM's opinion. Every signal shows its exact observed value, its
point contribution to the score, and raw evidence you can inspect. Built with
Next.js, TypeScript, and Solana's web3.js, with zero required API keys and no
database — a focused, transparent tool that helps users do their own research
faster, not a black-box "safe/scam" verdict.

## Scope & limitations

- This MVP focuses on the single-token analysis flow end to end, done well,
  rather than breadth of features. See "Deliberately out of scope" in
  `METHODOLOGY.md`.
- Holder-concentration data quality depends on RPC provider (see above).
- Market data (liquidity/volume/price) reflects whatever DexScreener has
  indexed; extremely new or unlisted tokens may show "no pools found," which
  is itself a meaningful risk signal, not a bug.
