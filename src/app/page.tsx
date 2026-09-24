"use client";

import { useCallback, useState } from "react";

import AmbientBackground from "@/components/AmbientBackground";
import LandingHero from "@/components/LandingHero";
import SignalLanes from "@/components/SignalLanes";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import TokenInputForm from "@/components/TokenInputForm";
import ReportView from "@/components/ReportView";
import ProductTour from "@/components/onboarding/ProductTour";
import { PRODUCT_TOUR } from "@/components/onboarding/tourSteps";
import { useProductTour } from "@/components/onboarding/useProductTour";
import type { RiskReport } from "@/lib/risk-engine/types";

type Status = "idle" | "loading" | "error" | "result";

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [report, setReport] = useState<RiskReport | null>(null);
  const [error, setError] = useState("");

  /*
   * Owned here so the header's replay control and the dialog address the
   * same tour. Nothing in the analysis path reads it.
   */
  const tour = useProductTour(PRODUCT_TOUR);

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
        <SiteHeader
          mode={compactLayout ? "result" : "landing"}
          onReset={reset}
          onOpenTour={tour.replay}
        />

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
            <div className="mx-auto max-w-[1280px]">
              <LandingHero onAnalyze={analyze} loading={loading} />
              {/* Breathing room before the supporting section begins. */}
              <div className="mt-16 sm:mt-20">
                {status === "idle" && <SignalLanes />}
                {loading && <ScanningState />}
                {status === "error" && <ErrorState message={error} />}
              </div>
            </div>
          )}
        </main>

        <SiteFooter />
      </div>

      <ProductTour tour={PRODUCT_TOUR} controller={tour} />
    </>
  );
}

/* -------------------------------------------------------------------------- */

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

