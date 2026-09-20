import type { AnalysisInput } from "../input";
import type { Evidence, RiskSignal, Severity } from "../types";
import { signal, unavailable } from "../helpers";
import { explorerAccountUrl } from "../../solana/knownAddresses";

const CATEGORY = "Authorities" as const;

/**
 * An active mint authority means new tokens can be created at will, diluting
 * every holder without warning. Renouncing it (setting it to null) is a
 * one-way, on-chain, independently verifiable action.
 */
export function mintAuthorityRule({ mintInfo }: AnalysisInput): RiskSignal {
  const authority = mintInfo.mintAuthority;
  const active = authority !== null;

  return signal({
    id: "mint-authority",
    label: "Mint Authority",
    category: CATEGORY,
    metric: "Whether new supply can still be minted",
    maxPoints: 20,
    severity: active ? "critical" : "none",
    observedValue: active ? "Active" : "Renounced",
    explanation: active
      ? "The mint authority has not been renounced. Whoever holds it can mint unlimited new tokens at any time, diluting every existing holder. This is the single most consequential control a deployer can retain. Some legitimate assets — notably fiat-backed stablecoins — keep it deliberately so the issuer can mint against reserves."
      : "The mint authority has been renounced (set to null). Total supply is fixed and cannot be increased by anyone, including the original deployer.",
    evidence: active
      ? [
          {
            label: "Mint authority",
            value: authority,
            href: explorerAccountUrl(authority),
          },
          { label: "Token program", value: mintInfo.tokenProgram },
        ]
      : [{ label: "Mint authority", value: "null (renounced)" }],
  });
}

/**
 * An active freeze authority lets its holder freeze any individual token
 * account, preventing that holder from transferring or selling.
 */
export function freezeAuthorityRule({ mintInfo }: AnalysisInput): RiskSignal {
  const authority = mintInfo.freezeAuthority;
  const active = authority !== null;

  return signal({
    id: "freeze-authority",
    label: "Freeze Authority",
    category: CATEGORY,
    metric: "Whether individual holders can be frozen",
    maxPoints: 14,
    severity: active ? "high" : "none",
    observedValue: active ? "Active" : "Renounced",
    explanation: active
      ? "The freeze authority has not been renounced. Whoever holds it can freeze any wallet's token account at will, blocking that holder from ever selling or transferring. Regulated stablecoins hold this authority deliberately, for sanctions compliance — so it is not automatically malicious, but it is real, unilateral control over your ability to exit."
      : "The freeze authority has been renounced (set to null). No account holding this token can be frozen.",
    evidence: active
      ? [
          {
            label: "Freeze authority",
            value: authority,
            href: explorerAccountUrl(authority),
          },
        ]
      : [{ label: "Freeze authority", value: "null (renounced)" }],
  });
}

/**
 * Token-2022 extensions that grant ongoing control over transfers.
 *
 * These are invisible in classic token checkers but can be far more severe
 * than a retained mint authority: a permanent delegate can move tokens out of
 * any wallet at any time.
 */
export function tokenExtensionsRule({ mintInfo }: AnalysisInput): RiskSignal {
  const MAX_POINTS = 18;
  const ID = "token-extensions";
  const LABEL = "Token-2022 Extensions";
  const METRIC = "Transfer-controlling mint extensions";

  if (mintInfo.tokenProgram !== "spl-token-2022") {
    return signal({
      id: ID,
      label: LABEL,
      category: CATEGORY,
      metric: METRIC,
      maxPoints: MAX_POINTS,
      severity: "none",
      observedValue: "Not applicable (classic SPL Token)",
      explanation:
        "This mint uses the classic SPL Token program, which has no extension mechanism. None of the Token-2022 transfer-control risks apply.",
      evidence: [{ label: "Token program", value: "spl-token" }],
    });
  }

  const findings: { severity: Severity; name: string; detail: string }[] = [];
  const evidence: Evidence[] = [
    { label: "Token program", value: "spl-token-2022" },
    {
      label: "Extensions present",
      value:
        mintInfo.extensions.map((e) => e.extension).join(", ") || "none",
    },
  ];

  for (const extension of mintInfo.extensions) {
    const state = extension.state as Record<string, unknown>;

    switch (extension.extension) {
      case "permanentDelegate": {
        const delegate = typeof state.delegate === "string" ? state.delegate : null;
        if (delegate) {
          findings.push({
            severity: "critical",
            name: "Permanent delegate",
            detail:
              "A permanent delegate can transfer or burn this token from any wallet, without the holder's consent, forever.",
          });
          evidence.push({
            label: "Permanent delegate",
            value: delegate,
            href: explorerAccountUrl(delegate),
          });
        }
        break;
      }

      case "nonTransferable":
        findings.push({
          severity: "critical",
          name: "Non-transferable",
          detail: "This token cannot be transferred at all. It can be received but never sold or sent on.",
        });
        break;

      case "transferHook": {
        const programId = typeof state.programId === "string" ? state.programId : null;
        if (programId) {
          findings.push({
            severity: "high",
            name: "Transfer hook",
            detail:
              "Every transfer calls a third-party program that can impose arbitrary conditions, including blocking the transfer entirely.",
          });
          evidence.push({
            label: "Transfer hook program",
            value: programId,
            href: explorerAccountUrl(programId),
          });
        }
        break;
      }

      case "transferFeeConfig": {
        const newer = state.newerTransferFee as
          | { transferFeeBasisPoints?: number }
          | undefined;
        const bps = Number(newer?.transferFeeBasisPoints ?? 0);
        if (bps > 0) {
          findings.push({
            severity: bps >= 500 ? "high" : "medium",
            name: `Transfer fee (${(bps / 100).toFixed(2)}%)`,
            detail: `Every transfer is taxed ${(bps / 100).toFixed(2)}%, which is withheld from the amount received.`,
          });
          evidence.push({
            label: "Transfer fee",
            value: `${(bps / 100).toFixed(2)}% (${bps} bps)`,
          });
        }
        break;
      }

      case "defaultAccountState": {
        if (state.accountState === "frozen") {
          findings.push({
            severity: "critical",
            name: "Default frozen accounts",
            detail:
              "New token accounts are frozen on creation and must be individually unfrozen by the authority before the holder can trade.",
          });
          evidence.push({ label: "Default account state", value: "frozen" });
        }
        break;
      }

      case "mintCloseAuthority": {
        const closeAuthority =
          typeof state.closeAuthority === "string" ? state.closeAuthority : null;
        if (closeAuthority) {
          findings.push({
            severity: "medium",
            name: "Mint close authority",
            detail: "The mint account itself can be closed once supply reaches zero.",
          });
        }
        break;
      }
    }
  }

  if (findings.length === 0) {
    return signal({
      id: ID,
      label: LABEL,
      category: CATEGORY,
      metric: METRIC,
      maxPoints: MAX_POINTS,
      severity: "none",
      observedValue: "No transfer-controlling extensions",
      explanation:
        "This is a Token-2022 mint, but none of its extensions grant ongoing control over transfers. The extensions it does use are informational only.",
      evidence,
    });
  }

  const ORDER: Severity[] = ["none", "low", "medium", "high", "critical"];
  const worst = findings.reduce(
    (acc, finding) =>
      ORDER.indexOf(finding.severity) > ORDER.indexOf(acc) ? finding.severity : acc,
    "none" as Severity,
  );

  return signal({
    id: ID,
    label: LABEL,
    category: CATEGORY,
    metric: METRIC,
    maxPoints: MAX_POINTS,
    severity: worst,
    observedValue: findings.map((f) => f.name).join(", "),
    explanation: `This Token-2022 mint uses ${findings.length === 1 ? "an extension that grants" : "extensions that grant"} ongoing control over transfers. ${findings
      .map((f) => f.detail)
      .join(" ")}`,
    evidence,
  });
}

/**
 * Mutable metadata means the name, symbol and off-chain URI can be rewritten
 * after purchase — a token can be relaunched under a new identity in place.
 */
export function metadataMutabilityRule({ metadata }: AnalysisInput): RiskSignal {
  const MAX_POINTS = 6;
  const ID = "metadata-mutability";
  const LABEL = "Metadata Mutability";
  const METRIC = "Whether token identity can still be changed";

  if (metadata.source === "none" || metadata.isMutable === null) {
    return unavailable({
      id: ID,
      label: LABEL,
      category: CATEGORY,
      metric: METRIC,
      maxPoints: MAX_POINTS,
      reason:
        "No on-chain metadata account was found for this mint, so mutability cannot be determined. A token with no metadata at all has no name or symbol to change, but also no verifiable identity.",
    });
  }

  const mutable = metadata.isMutable;
  const evidence: Evidence[] = [
    { label: "Metadata standard", value: metadata.source },
    { label: "Mutable", value: String(mutable) },
  ];
  if (metadata.updateAuthority) {
    evidence.push({
      label: "Update authority",
      value: metadata.updateAuthority,
      href: explorerAccountUrl(metadata.updateAuthority),
    });
  }
  if (metadata.metadataAccount) {
    evidence.push({
      label: "Metadata account",
      value: metadata.metadataAccount,
      href: explorerAccountUrl(metadata.metadataAccount),
    });
  }

  return signal({
    id: ID,
    label: LABEL,
    category: CATEGORY,
    metric: METRIC,
    maxPoints: MAX_POINTS,
    severity: mutable ? "medium" : "none",
    observedValue: mutable ? "Mutable" : "Immutable",
    explanation: mutable
      ? "The token's metadata is still mutable. Its name, symbol and image can be changed at any time by the update authority, so the identity shown today is not guaranteed to persist. This is common and often benign, but it does mean a token can be quietly rebranded into something else."
      : "The token's metadata is immutable. Its name, symbol and image are permanently fixed on chain and cannot be rewritten.",
    evidence,
  });
}
