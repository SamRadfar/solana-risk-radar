"use client";

import { useState } from "react";

interface Props {
  onAnalyze: (address: string) => void;
  loading: boolean;
  initialValue?: string;
}

const EXAMPLE_TOKENS = [
  { label: "USDC", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  { label: "Wrapped SOL", address: "So11111111111111111111111111111111111111112" },
  { label: "Jupiter (JUP)", address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
];

export default function TokenInputForm({ onAnalyze, loading, initialValue }: Props) {
  const [value, setValue] = useState(initialValue ?? "");

  function submit(addr: string) {
    const trimmed = addr.trim();
    if (!trimmed || loading) return;
    onAnalyze(trimmed);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
      className="w-full"
    >
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste a Solana token mint address…"
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded-xl border px-4 py-3.5 text-[15px] font-mono outline-none transition-colors"
            style={{
              background: "var(--surface)",
              borderColor: "var(--border)",
              color: "var(--foreground)",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent-dim)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
          />
        </div>
        <button
          type="submit"
          disabled={loading || !value.trim()}
          className="rounded-xl px-6 py-3.5 font-medium text-[15px] transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
          style={{
            background: "var(--accent)",
            color: "#06231f",
          }}
        >
          {loading ? "Analyzing…" : "Analyze Token"}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span style={{ color: "var(--muted)" }}>Try:</span>
        {EXAMPLE_TOKENS.map((t) => (
          <button
            key={t.address}
            type="button"
            onClick={() => {
              setValue(t.address);
              submit(t.address);
            }}
            disabled={loading}
            className="rounded-full px-3 py-1 transition-colors cursor-pointer disabled:opacity-40"
            style={{ background: "var(--surface-2)", color: "var(--foreground)", border: "1px solid var(--border)" }}
          >
            {t.label}
          </button>
        ))}
      </div>
    </form>
  );
}
