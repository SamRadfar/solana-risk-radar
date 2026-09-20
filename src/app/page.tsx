"use client";

import { useCallback, useState } from "react";

import AmbientBackground from "@/components/AmbientBackground";
import TokenInputForm from "@/components/TokenInputForm";
import ReportView from "@/components/ReportView";
import type { RiskReport } from "@/lib/risk-engine/types";

type Status = "idle" | "loading" | "error" | "result";

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [report, setReport] = useState<RiskReport | null>(null);
  const [error, setError] = useState("");

  const analyze = useCallback(async (address: string) => {
    setStatus("loading");
    try {
      const response = await fetch(`/api/analyze?address=${encodeURIComponent(address)}`);
      const payload = await response.json();

      if (!response.ok) {
        setError(
          typeof payload?.error === "string"
            ? payload.error
            : "The analysis service returned an unexpected response.",
        );
        setStatus("error");
        return;
      }

      setReport(payload as RiskReport);
      setStatus("result");
    } catch {
      setError("Could not reach the analysis service. Check your connection and try again.");
      setStatus("error");
    }
  }, []);

  const reset = useCallback(() => {
    setReport(null);
    setError("");
    setStatus("idle");
  }, []);

  const loading = status === "loading";

  /*
   * Once a report exists the page stays in its compact, report-first layout —
   * including while a *new* token is being analysed. Snapping back to the
   * marketing hero mid-analysis would feel like losing your place.
   */
  const compactLayout = report !== null;

  return (
    <>
      <AmbientBackground />

      <div className="relative z-10 min-h-screen flex flex-col">
        <SiteHeader onReset={reset} canReset={compactLayout} />

        <main className="flex-1 w-full mx-auto px-4 sm:px-6 py-8 sm:py-10 max-w-[1500px]">
          {compactLayout ? (
            <>
              <div className="max-w-2xl mb-6">
                <TokenInputForm onAnalyze={analyze} loading={loading} compact />
              </div>
              {loading && <ScanningState />}
              {status === "error" && <ErrorState message={error} />}
              {status === "result" && report && <ReportView report={report} />}
            </>
          ) : (
            <div className="max-w-3xl mx-auto">
              <Hero />
              <div className="mt-8">
                <TokenInputForm onAnalyze={analyze} loading={loading} />
              </div>
              <div className="mt-10">
                {status === "idle" && <WhatGetsChecked />}
                {loading && <ScanningState />}
                {status === "error" && <ErrorState message={error} />}
              </div>
            </div>
          )}
        </main>

        <SiteFooter />
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function SiteHeader({
  onReset,
  canReset,
}: {
  onReset: () => void;
  canReset: boolean;
}) {
  return (
    <header
      className="sticky top-0 z-40"
      style={{
        height: "var(--header-h)",
        background: "rgba(5,6,10,0.72)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div className="h-full max-w-[1500px] mx-auto px-4 sm:px-6 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onReset}
          disabled={!canReset}
          aria-label={canReset ? "Start a new analysis" : "Solana Risk Radar"}
          className={`flex items-center gap-2.5 min-w-0 text-left ${
            canReset ? "cursor-pointer" : "cursor-default"
          }`}
        >
          <RadarMark />
          <span className="min-w-0">
            <span className="block font-semibold text-[14px] leading-tight truncate">
              Solana Risk Radar
            </span>
            <span
              className="hidden sm:block text-[11px] leading-tight"
              style={{ color: "var(--ink-muted)" }}
            >
              Deterministic risk signals, not predictions
            </span>
          </span>
        </button>

        <div className="hidden md:flex items-center gap-2 text-[11px]">
          <Pill>Deterministic</Pill>
          <Pill>No API keys</Pill>
          <Pill>Evidence-backed</Pill>
        </div>
      </div>
    </header>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="px-2.5 py-1 rounded-full"
      style={{
        border: "1px solid var(--line)",
        background: "rgba(255,255,255,0.03)",
        color: "var(--ink-muted)",
      }}
    >
      {children}
    </span>
  );
}

function RadarMark() {
  return (
    <span
      className="relative h-8 w-8 rounded-[10px] flex items-center justify-center shrink-0"
      style={{
        background: "linear-gradient(140deg, rgba(56,214,236,0.18), rgba(99,102,241,0.18))",
        border: "1px solid var(--line-strong)",
      }}
      aria-hidden="true"
    >
      <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="7" stroke="rgba(255,255,255,0.22)" strokeWidth="1.1" />
        <circle cx="9" cy="9" r="3.6" stroke="rgba(255,255,255,0.22)" strokeWidth="1.1" />
        <path d="M9 9L14.2 5.2" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="9" cy="9" r="1.35" fill="var(--accent)" />
      </svg>
    </span>
  );
}

function Hero() {
  return (
    <div className="text-center rise">
      <span
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px]"
        style={{
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)",
          color: "var(--ink-secondary)",
        }}
      >
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--accent)", boxShadow: "0 0 8px var(--accent-glow)" }}
        />
        14 deterministic signals · 5 risk categories
      </span>

      <h1
        className="mt-5 display text-[38px] sm:text-[56px] font-semibold"
        style={{ color: "#fff" }}
      >
        Know a token&rsquo;s risk
        <br />
        <span className="grad-text">before you touch it</span>
      </h1>

      <p
        className="mt-5 text-[15px] sm:text-[17px] leading-relaxed max-w-xl mx-auto"
        style={{ color: "var(--ink-secondary)" }}
      >
        Paste any Solana mint address. Risk Radar reads real on-chain and market data, scores
        it with a transparent rule engine, and shows you exactly which signals drove the
        result — with the evidence behind every one.
      </p>
    </div>
  );
}

function WhatGetsChecked() {
  const checks: [string, string][] = [
    ["Authorities", "Can supply still be minted, wallets frozen, or transfers intercepted?"],
    ["Holders", "How much of the sellable supply sits in the largest wallets?"],
    ["Liquidity", "Is there a real market deep enough to exit into?"],
    ["Market activity", "Is trading healthy, dormant, or suspiciously inflated?"],
    ["Maturity", "How long have the token and its market actually existed?"],
  ];

  return (
    <div className="rise">
      <div className="eyebrow text-center mb-4">What gets checked</div>
      <div className="grid gap-3 sm:grid-cols-2">
        {checks.map(([title, description], index) => (
          <div
            key={title}
            className={`card card-hover p-4 flex gap-3.5 ${
              index === checks.length - 1 ? "sm:col-span-2" : ""
            }`}
          >
            <span
              aria-hidden="true"
              className="tnum h-8 w-8 rounded-[9px] shrink-0 flex items-center justify-center text-[11px] font-semibold"
              style={{
                background: "rgba(56,214,236,0.08)",
                border: "1px solid var(--line)",
                color: "var(--accent)",
              }}
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <h3 className="font-medium text-sm">{title}</h3>
              <p
                className="text-[13px] mt-1 leading-relaxed"
                style={{ color: "var(--ink-secondary)" }}
              >
                {description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScanningState() {
  const stages = [
    "Reading the mint account",
    "Resolving and classifying top holders",
    "Decoding on-chain metadata",
    "Pulling liquidity and market data",
  ];

  return (
    <div className="card card-lit p-6 sm:p-8 rise" role="status" aria-live="polite">
      <span className="sr-only">Analysing token…</span>

      <div className="flex items-center gap-4">
        <div
          className="relative h-11 w-11 rounded-full shrink-0 flex items-center justify-center overflow-hidden"
          style={{ border: "1px solid var(--line-accent)", background: "rgba(56,214,236,0.06)" }}
        >
          <span
            className="h-2 w-2 rounded-full shimmer"
            style={{ background: "var(--accent)", boxShadow: "0 0 12px var(--accent-glow)" }}
          />
        </div>
        <div>
          <div className="font-medium">Analysing token</div>
          <div className="text-[13px] mt-0.5" style={{ color: "var(--ink-muted)" }}>
            Holder scans take a few seconds on public RPC endpoints.
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-2.5">
        {stages.map((stage) => (
          <div key={stage} className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full shrink-0 shimmer"
              style={{ background: "var(--accent)" }}
            />
            <span className="text-[13px]" style={{ color: "var(--ink-secondary)" }}>
              {stage}
            </span>
          </div>
        ))}
      </div>

      <div
        className="sweep relative mt-6 h-[3px] rounded-full overflow-hidden"
        style={{ background: "rgba(255,255,255,0.06)" }}
        aria-hidden="true"
      />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      className="card p-5 rise"
      style={{ borderColor: "rgba(229,72,77,0.35)", background: "rgba(229,72,77,0.05)" }}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 h-6 w-6 rounded-md shrink-0 flex items-center justify-center text-[11px]"
          style={{ background: "rgba(229,72,77,0.14)", color: "#e5484d" }}
        >
          ■
        </span>
        <div className="min-w-0">
          <strong className="text-sm" style={{ color: "#e5484d" }}>
            Could not analyse this address
          </strong>
          <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
            {message}
          </p>
        </div>
      </div>
    </div>
  );
}

function SiteFooter() {
  return (
    <footer
      className="relative z-10 mt-8"
      style={{ borderTop: "1px solid var(--line)" }}
    >
      <div className="max-w-[1500px] mx-auto px-4 sm:px-6 py-7 text-[11px] leading-relaxed text-center sm:text-left sm:flex sm:items-center sm:justify-between gap-4">
        <p style={{ color: "var(--ink-faint)" }}>
          On-chain data from Solana RPC and the Metaplex / Token-2022 metadata standards.
          Market data from DexScreener.
        </p>
        <p className="mt-2 sm:mt-0 shrink-0" style={{ color: "var(--ink-faint)" }}>
          Built for the Superteam Germany Road to Colosseum Hackathon
        </p>
      </div>
    </footer>
  );
}
