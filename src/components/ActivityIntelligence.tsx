"use client";

import { useEffect, useRef, useState } from "react";
import type { ActivityEvidenceResult, ShareMetric } from "@/lib/activity/types";

const percent = (n: number | null) => n === null ? "Unavailable" : `${(n * 100).toFixed(1)}%`;
const share = (m?: ShareMetric) => m ? `${percent(m.share)} (${m.numerator}/${m.denominator}; ${m.walletsIncluded} addresses)` : "Unavailable";

export default function ActivityIntelligence({ mint }: { mint: string }) {
  const [result, setResult] = useState<ActivityEvidenceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function load() {
    if (controller.current) return;
    const request = new AbortController(); controller.current = request;
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/activity?address=${encodeURIComponent(mint)}`, { signal: request.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Activity HTTP ${response.status}`);
      setResult(body as ActivityEvidenceResult);
    } catch (err) {
      if (!request.signal.aborted) setError(err instanceof Error ? err.message : "Activity evidence unavailable");
    } finally { controller.current = null; if (!request.signal.aborted) setLoading(false); }
  }
  const features = result?.features;
  return (
    <details data-testid="activity-intelligence" className="my-5 border-t py-4 text-sm" style={{ borderColor: "var(--line)", color: "var(--ink-muted)" }}
      onToggle={event => { if (event.currentTarget.open && !result && !loading && !error) void load(); }}>
      <summary className="cursor-pointer font-medium" style={{ color: "var(--ink)" }}>Activity Intelligence</summary>
      <p className="mt-3">Observation only — not yet included in risk score. Coverage and the 13 scored signals are unchanged.</p>
      {loading && <p role="status">Acquiring bounded recent evidence…</p>}
      {error && <p role="status">Unavailable: {error}</p>}
      {result && <div className="mt-3 space-y-3 break-words">
        <p><strong>{result.status}</strong> · Requested 60 min · Observed {result.observedWindow ? `${(result.observedWindow.lengthMs / 60000).toFixed(1)} min` : "unavailable"} · {result.economicActions} economic actions · {percent(result.traderResolutionCoverage)} trader resolution</p>
        <p>{result.truncated ? "Truncated sample" : "Bounded sample"} · {result.recordsExamined} unique successful records examined · {percent(result.parserCoverage)} eligible-record parse coverage · {result.unresolvedTraderCount} unresolved actions · failed transactions filtered server-side</p>
        {features && result.metrics && <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {([
            ["participants", "Resolved unique buyers", features.uniqueBuyers], ["participants", "Resolved unique sellers", features.uniqueSellers],
            ["concentration", "Top 1 trade share", features.concentration && share(features.concentration.trade.top1)], ["concentration", "Top 5 trade share", features.concentration && share(features.concentration.trade.top5)],
            ["concentration", "Top 10 trade share", features.concentration && share(features.concentration.trade.top10)], ["concentration", "Top 1 token-volume share", features.concentration && share(features.concentration.volume.top1)],
            ["concentration", "Top 5 token-volume share", features.concentration && share(features.concentration.volume.top5)], ["concentration", "Top 10 token-volume share", features.concentration && share(features.concentration.volume.top10)],
            ["cycling", "Addresses with observed cycles", features.cycling?.walletsWithCycles], ["cycling", "Equal-size observed round-trip pairs", features.cycling?.roundTripCount],
            ["repeatedSizes", "Records in repeated-size groups", features.repeatedSizes?.recordsInRepeatedGroups], ["cadence", "Median distinct-slot trade gap", features.cadence && (features.cadence.medianSeconds === null ? "Unavailable" : `${features.cadence.medianSeconds}s`)],
          ] as const).map(([metric, label, value]) => {
            const m = result.metrics![metric];
            return <div key={label}><dt>{label} <span className="text-xs">({m.status}{m.basis === "resolved-trader-subset" ? ` · resolved subset ${m.sampleSize} actions, ${percent(m.actionCoverage)} of actions` : ""})</span></dt>
              <dd style={{ color: "var(--ink)" }}>{value === null || value === undefined ? `Withheld: ${m.reasons.join("; ")}` : value}</dd></div>;
          })}
        </dl>}
        <p>Trader-dependent metrics describe only resolved actions in this sample, which can differ from unresolved (often routed) activity. Addresses are not independent people. Observed cycling can reflect arbitrage or market making.</p>
        <p>Fetched {new Date(result.fetchedAt).toISOString()} · {result.version} · {result.requestCount} provider requests · {result.elapsedMs} ms</p>
        <p>Pools: {result.poolsCovered.map(p => `${p.venue} (${p.address})`).join(", ") || "None measured"}</p>
        {[...result.errors, ...result.stoppingReasons.filter(r => !result.errors.includes(r))].map(reason => <p key={reason}>{reason}</p>)}
        <details><summary className="cursor-pointer">Evidence and limitations</summary>
          <ul className="mt-2 list-disc pl-5">{result.limitations.map(l => <li key={l}>{l}</li>)}</ul>
          <p className="mt-2">First 20 action references (complete normalized snapshot available below). Raw evidence may expire or reside on another server instance.</p>
          <ul>{result.evidence.slice(0, 20).map(e => <li key={e.economicActionId} className="my-1 break-all">
            <a className="underline" href={`/api/activity?address=${encodeURIComponent(mint)}&snapshot=${result.snapshotId}&signature=${encodeURIComponent(e.signature)}`} target="_blank" rel="noreferrer">{e.signature}</a> · {e.side} · {e.traderResolutionStatus}
          </li>)}</ul>
          <details><summary className="cursor-pointer">Normalized snapshot JSON</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(result, null, 2)}</pre></details>
        </details>
      </div>}
      {!loading && (result || error) && <button type="button" className="mt-3 underline" onClick={() => void load()}>Refresh activity evidence</button>}
    </details>
  );
}
