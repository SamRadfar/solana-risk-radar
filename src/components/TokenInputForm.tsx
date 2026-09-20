"use client";

import { useState } from "react";

import { validateMintAddress } from "@/lib/solana/address";

interface Props {
  onAnalyze: (address: string) => void;
  loading: boolean;
  /** Compact variant used once a report is on screen. */
  compact?: boolean;
  /**
   * Renders the field as a recessed well rather than a raised card, for use
   * inside another surface (the landing analyser panel). Defaults to false, so
   * every existing call site is unaffected.
   */
  inset?: boolean;
  /**
   * Stacks the field above a full-width action instead of placing them on one
   * row. The row layout keys off *viewport* breakpoints, which misreads a
   * narrow container on a wide screen — inside the landing analyser panel that
   * squeezed the field until the placeholder truncated. Defaults to false.
   */
  stack?: boolean;
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
export default function TokenInputForm({
  onAnalyze,
  loading,
  compact = false,
  inset = false,
  stack = false,
}: Props) {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);

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

      <div
        className="relative rounded-[16px] transition-all duration-300"
        style={{
          // The focus glow is the one place chrome colour is allowed to bloom.
          boxShadow: focused
            ? "0 0 0 1px rgba(56,214,236,0.45), 0 12px 48px -18px rgba(56,214,236,0.55)"
            : "none",
        }}
      >
        <div
          className={`${inset ? "inset" : "card"} flex ${
            stack ? "flex-col" : "flex-col sm:flex-row"
          } gap-2 p-2 transition-colors`}
          style={{
            borderColor: showError
              ? "rgba(229,72,77,0.5)"
              : focused
                ? "var(--line-accent)"
                : undefined,
          }}
        >
          <div className="flex items-center gap-2.5 flex-1 min-w-0 pl-3">
            <span aria-hidden="true" className="shrink-0" style={{ color: "var(--ink-faint)" }}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </span>
            <input
              id="mint-address"
              type="text"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                setFocused(false);
                setTouched(true);
              }}
              placeholder="Paste a Solana token mint address…"
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              aria-invalid={showError}
              aria-describedby={showError ? "mint-address-error" : undefined}
              className={`w-full min-w-0 bg-transparent outline-none font-mono ${
                compact ? "py-2.5 text-[13px]" : "py-3 text-[15px]"
              }`}
              style={{ color: "var(--ink)" }}
            />
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className={`btn-accent cursor-pointer whitespace-nowrap ${
              compact ? "px-4 py-2.5 text-[13px]" : "px-6 py-3 text-[15px]"
            } ${stack ? "w-full" : ""}`}
          >
            {loading ? "Analysing…" : "Analyse"}
          </button>
        </div>
      </div>

      <div className={compact ? "mt-2" : "mt-3 min-h-[1.5rem]"}>
        {showError ? (
          <p
            id="mint-address-error"
            className="text-xs flex items-center gap-1.5"
            style={{ color: "#e5484d" }}
            role="alert"
          >
            <span aria-hidden="true">■</span>
            {validation.reason}
          </p>
        ) : (
          !compact && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span style={{ color: "var(--ink-faint)" }}>Try</span>
              {EXAMPLES.map((example) => (
                <button
                  key={example.address}
                  type="button"
                  onClick={() => {
                    setValue(example.address);
                    submit(example.address);
                  }}
                  disabled={loading}
                  className="chip px-2.5 py-1 cursor-pointer disabled:opacity-40"
                >
                  {example.label}
                </button>
              ))}
            </div>
          )
        )}
      </div>
    </form>
  );
}
