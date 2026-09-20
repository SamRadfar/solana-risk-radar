import type { RiskSignal } from "../types";
import type { AnalysisInput } from "../input";

const MAX_POINTS = 15;

/**
 * An active freeze authority lets its holder freeze any individual token
 * account, preventing that holder from transferring or selling their tokens.
 */
export function freezeAuthorityRule({ mintInfo }: AnalysisInput): RiskSignal {
  const active = mintInfo.freezeAuthority !== null;

  return {
    id: "freeze-authority",
    label: "Freeze Authority",
    category: "Authorities",
    status: "ok",
    observedValue: active ? `Active (${mintInfo.freezeAuthority})` : "Renounced (null)",
    severity: active ? "medium" : "none",
    maxPoints: MAX_POINTS,
    points: active ? MAX_POINTS : 0,
    explanation: active
      ? "The freeze authority has not been renounced. The holder of this authority can freeze any wallet's token account, blocking that holder from selling or transferring."
      : "The freeze authority has been renounced (set to null). No account holding this token can be frozen.",
    evidence: {
      freezeAuthority: mintInfo.freezeAuthority,
    },
  };
}
