"use client";

import { useState, useCallback } from "react";
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
      const res = await fetch(`/api/analyze?address=${encodeURIComponent(address)}`);
      const json = await res.json();
      if (!res.ok) {
        setState({ kind: "error", message: json.error ?? "Something went wrong." });
        return;
      }
      setState({ kind: "result", report: json as RiskReport });
    } catch {
      setState({ kind: "error", message: "Network error — could not reach the analysis service." });
    }
  }, []);

  return (
    <div className="min-h-screen">
      <header className="border-b" style={{ borderColor: "var(--border)" }}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5 flex items-center gap-3">
          <div
            className="h-8 w-8 rounded-lg flex items-center justify-center font-bold text-sm"
            style={{ background: "var(--accent)", color: "#06231f" }}
          >
            R
          </div>
          <div>
            <h1 className="font-semibold text-[15px] leading-tight">Solana Risk Radar</h1>
            <p className="text-xs leading-tight" style={{ color: "var(--muted)" }}>
              Deterministic risk signals, not predictions
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        {state.kind !== "result" && (
          <div className="text-center mb-10 max-w-2xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-balance">
              Understand a Solana token&apos;s risk in seconds
            </h2>
            <p className="mt-3 text-base sm:text-lg text-balance" style={{ color: "var(--muted)" }}>
              Paste a mint address. We pull real on-chain and market data, run it through a transparent scoring
              engine, and show you exactly which signals drove the result.
            </p>
          </div>
        )}

        <TokenInputForm onAnalyze={analyze} loading={state.kind === "loading"} />

        <div className="mt-10">
          {state.kind === "loading" && <LoadingState />}
          {state.kind === "error" && <ErrorState message={state.message} />}
          {state.kind === "result" && <ReportView report={state.report} />}
          {state.kind === "idle" && <EmptyState />}
        </div>
      </main>

      <footer className="max-w-4xl mx-auto px-4 sm:px-6 py-8 text-center text-xs" style={{ color: "var(--muted)" }}>
        Data from Solana RPC, on-chain Metaplex metadata, and DexScreener. Built for the Superteam Germany Road to
        Colosseum Hackathon.
      </footer>
    </div>
  );
}

function EmptyState() {
  const points = [
    ["Mint & freeze authority", "Can the deployer mint more tokens or freeze your wallet?"],
    ["Holder concentration", "How much of supply sits in the largest accounts?"],
    ["Liquidity & pool maturity", "Is there a real, aged market to trade against?"],
    ["Trading activity", "Is volume healthy, dead, or suspiciously high?"],
  ];
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {points.map(([title, desc]) => (
        <div
          key={title}
          className="rounded-xl border p-4"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <h3 className="font-medium text-sm">{title}</h3>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            {desc}
          </p>
        </div>
      ))}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border p-8 animate-pulse" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="flex gap-6 items-center">
          <div className="h-36 w-36 rounded-full shrink-0" style={{ background: "var(--surface-2)" }} />
          <div className="flex-1 space-y-3">
            <div className="h-5 w-48 rounded" style={{ background: "var(--surface-2)" }} />
            <div className="h-4 w-64 rounded" style={{ background: "var(--surface-2)" }} />
            <div className="h-6 w-40 rounded-full" style={{ background: "var(--surface-2)" }} />
          </div>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-28 rounded-xl border animate-pulse"
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
      className="rounded-xl border p-5 text-sm"
      style={{ borderColor: "#f8514955", background: "rgba(248,81,73,0.08)", color: "#f85149" }}
    >
      <strong>Couldn&apos;t analyze this address.</strong>
      <p className="mt-1" style={{ color: "var(--foreground)", opacity: 0.85 }}>
        {message}
      </p>
    </div>
  );
}
