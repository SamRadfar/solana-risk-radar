"use client";

import { useCallback, useState } from "react";

import TokenInputForm from "@/components/TokenInputForm";
import ReportView from "@/components/ReportView";
import type { RiskReport } from "@/lib/risk-engine/types";

type ViewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "result"; report: RiskReport };

export default function Home() {
  const [state, setState] = useState<ViewState>({ kind: "idle" });

  const analyze = useCallback(async (address: string) => {
    setState({ kind: "loading" });
    try {
      const response = await fetch(
        `/api/analyze?address=${encodeURIComponent(address)}`,
      );
      const payload = await response.json();

      if (!response.ok) {
        setState({
          kind: "error",
          message:
            typeof payload?.error === "string"
              ? payload.error
              : "The analysis service returned an unexpected response.",
        });
        return;
      }

      setState({ kind: "result", report: payload as RiskReport });
    } catch {
      setState({
        kind: "error",
        message:
          "Could not reach the analysis service. Check your connection and try again.",
      });
    }
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b" style={{ borderColor: "var(--border)" }}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <RadarMark />
          <div className="min-w-0">
            <h1 className="font-semibold text-[15px] leading-tight">Solana Risk Radar</h1>
            <p className="text-xs leading-tight" style={{ color: "var(--muted)" }}>
              Deterministic risk signals, not predictions
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {state.kind !== "result" && (
          <div className="text-center max-w-2xl mx-auto mb-8">
            <h2 className="text-3xl sm:text-[2.5rem] font-semibold tracking-tight leading-[1.1]">
              Understand a Solana token&rsquo;s risk in seconds
            </h2>
            <p
              className="mt-3.5 text-base sm:text-lg leading-relaxed"
              style={{ color: "var(--muted-strong)" }}
            >
              Paste a mint address. Risk Radar reads real on-chain and market data, scores it
              with a transparent rule engine, and shows you exactly which signals drove the
              result &mdash; with the evidence behind every one.
            </p>
          </div>
        )}

        <TokenInputForm onAnalyze={analyze} loading={state.kind === "loading"} />

        <div className="mt-8">
          {state.kind === "idle" && <EmptyState />}
          {state.kind === "loading" && <LoadingState />}
          {state.kind === "error" && <ErrorState message={state.message} />}
          {state.kind === "result" && <ReportView report={state.report} />}
        </div>
      </main>

      <footer
        className="max-w-4xl mx-auto w-full px-4 sm:px-6 py-8 text-xs text-center leading-relaxed"
        style={{ color: "var(--muted)" }}
      >
        On-chain data from Solana RPC and the Metaplex / Token-2022 metadata standards.
        Market data from DexScreener. No API keys, no account, no tracking.
        <br />
        Built for the Superteam Germany Road to Colosseum Hackathon.
      </footer>
    </div>
  );
}

function RadarMark() {
  return (
    <div
      className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
      aria-hidden="true"
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="7" stroke="var(--border-strong)" strokeWidth="1.2" />
        <circle cx="9" cy="9" r="3.5" stroke="var(--border-strong)" strokeWidth="1.2" />
        <path d="M9 9L14 5.5" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="9" cy="9" r="1.3" fill="var(--accent)" />
      </svg>
    </div>
  );
}

function EmptyState() {
  const checks = [
    ["Authorities", "Can supply still be minted, wallets frozen, or transfers intercepted?"],
    ["Holders", "How much of the sellable supply sits in the largest wallets?"],
    ["Liquidity", "Is there a real market deep enough to exit into?"],
    ["Market activity", "Is trading healthy, dormant, or suspiciously inflated?"],
    ["Maturity", "How long have the token and its market actually existed?"],
  ];

  return (
    <div>
      <p className="text-xs uppercase tracking-[0.14em] mb-3" style={{ color: "var(--muted)" }}>
        What gets checked
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        {checks.map(([title, description]) => (
          <div
            key={title}
            className="rounded-xl border p-4"
            style={{ borderColor: "var(--border)", background: "var(--surface)" }}
          >
            <h3 className="font-medium text-sm">{title}</h3>
            <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--muted)" }}>
              {description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <span className="sr-only">Analysing token…</span>

      <div
        className="rounded-2xl border p-5 sm:p-7"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 sm:items-center">
          <div
            className="h-[168px] w-[168px] rounded-full shrink-0 animate-shimmer"
            style={{ background: "var(--surface-2)" }}
          />
          <div className="flex-1 space-y-3">
            <div className="h-6 w-44 rounded animate-shimmer" style={{ background: "var(--surface-2)" }} />
            <div className="h-5 w-56 rounded animate-shimmer" style={{ background: "var(--surface-2)" }} />
            <div className="h-4 w-full max-w-md rounded animate-shimmer" style={{ background: "var(--surface-2)" }} />
            <p className="text-xs pt-1" style={{ color: "var(--muted)" }}>
              Reading the mint account, resolving top holders, and pulling market data…
              <br />
              Holder scans can take a few seconds on public RPC endpoints.
            </p>
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-32 rounded-xl border animate-shimmer"
            style={{ borderColor: "var(--border)", background: "var(--surface)" }}
          />
        ))}
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl border p-5"
      style={{ borderColor: "rgba(229,72,77,0.4)", background: "rgba(229,72,77,0.07)" }}
      role="alert"
    >
      <strong className="text-sm" style={{ color: "#e5484d" }}>
        Could not analyse this address
      </strong>
      <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--muted-strong)" }}>
        {message}
      </p>
    </div>
  );
}
