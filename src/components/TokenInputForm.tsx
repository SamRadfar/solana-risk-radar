"use client";

import { useState } from "react";

import { validateMintAddress } from "@/lib/solana/address";

interface Props {
  onAnalyze: (address: string) => void;
  loading: boolean;
}

const EXAMPLES = [
  { label: "USDC", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  { label: "BONK", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  { label: "JUP", address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  { label: "PYUSD", address: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo" },
];

/**
 * The address input.
 *
 * Validation runs in the browser using the same pure function the server uses,
 * so a malformed address is caught instantly without a round trip — but the
 * server still re-validates, because client-side checks are a convenience and
 * never a trust boundary.
 */
export default function TokenInputForm({ onAnalyze, loading }: Props) {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);

  const trimmed = value.trim();
  const validation = trimmed.length > 0 ? validateMintAddress(trimmed) : null;
  const showError = touched && validation !== null && !validation.valid;
  const canSubmit = validation?.valid === true && !loading;

  function submit(address: string) {
    const candidate = address.trim();
    if (loading) return;
    setTouched(true);
    if (!validateMintAddress(candidate).valid) return;
    onAnalyze(candidate);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit(value);
      }}
      className="w-full"
    >
      <label htmlFor="mint-address" className="sr-only">
        Solana token mint address
      </label>

      <div className="flex flex-col sm:flex-row gap-2.5">
        <input
          id="mint-address"
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="Paste a Solana token mint address…"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={showError}
          aria-describedby={showError ? "mint-address-error" : undefined}
          className="flex-1 min-w-0 rounded-xl border px-4 py-3.5 text-[15px] font-mono outline-none transition-colors"
          style={{
            background: "var(--surface)",
            borderColor: showError ? "rgba(229,72,77,0.55)" : "var(--border)",
            color: "var(--foreground)",
          }}
        />

        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-xl px-6 py-3.5 font-medium text-[15px] transition-opacity disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
          style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
        >
          {loading ? "Analysing…" : "Analyse token"}
        </button>
      </div>

      <div className="mt-2.5 min-h-[1.25rem]">
        {showError ? (
          <p id="mint-address-error" className="text-xs" style={{ color: "#e5484d" }} role="alert">
            {validation.reason}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span style={{ color: "var(--muted)" }}>Try:</span>
            {EXAMPLES.map((example) => (
              <button
                key={example.address}
                type="button"
                onClick={() => {
                  setValue(example.address);
                  submit(example.address);
                }}
                disabled={loading}
                className="rounded-full px-2.5 py-1 cursor-pointer transition-colors disabled:opacity-40 border"
                style={{
                  background: "var(--surface-2)",
                  borderColor: "var(--border)",
                  color: "var(--muted-strong)",
                }}
              >
                {example.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </form>
  );
}
