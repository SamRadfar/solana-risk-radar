import type { RiskSignal } from "../types";
import type { AnalysisInput } from "../input";

const MAX_POINTS = 20;

/**
 * An active mint authority means the deployer can create new tokens at will,
 * diluting every holder without warning. Renouncing it (setting it to null)
 * is a one-way, on-chain, verifiable action.
 */
export function mintAuthorityRule({ mintInfo }: AnalysisInput): RiskSignal {
  const active = mintInfo.mintAuthority !== null;

  return {
    id: "mint-authority",
    label: "Mint Authority",
    category: "Authorities",
    status: "ok",
    observedValue: active ? `Active (${mintInfo.mintAuthority})` : "Renounced (null)",
    severity: active ? "high" : "none",
    maxPoints: MAX_POINTS,
    points: active ? MAX_POINTS : 0,
    explanation: active
      ? "The mint authority has not been renounced. The holder of this authority can mint new tokens at any time, arbitrarily increasing supply and diluting existing holders."
      : "The mint authority has been renounced (set to null). Total supply is fixed and can never be increased by anyone.",
    evidence: {
      mintAuthority: mintInfo.mintAuthority,
      tokenProgram: mintInfo.tokenProgram,
    },
  };
}
