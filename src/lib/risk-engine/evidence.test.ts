import { describe, expect, it } from "vitest";

import { RULES, buildRiskReport } from "./engine";
import type { AnalysisInput } from "./input";
import type { DataSourceStatus, RiskSignal, TokenOverview } from "./types";
import { makeInput, pair } from "./test-fixtures";

/**
 * Evidence audit.
 *
 * "Inspect evidence" is the product's core trust claim: every number in the
 * score must open onto the data that produced it. These tests hold every rule
 * to that claim — evidence must exist, be well-formed, be about the metric the
 * signal measured, and must never imply a measurement happened when it did not.
 */

const build = (input: AnalysisInput) =>
  buildRiskReport(input, {
    overview: {} as TokenOverview,
    sources: [] as DataSourceStatus[],
    elapsedMs: 0,
  });

const signalById = (input: AnalysisInput, id: string): RiskSignal => {
  const found = build(input).signals.find((s) => s.id === id);
  if (!found) throw new Error(`no signal with id "${id}"`);
  return found;
};

/** Inputs chosen so that every rule produces a *measured* signal. */
function fullyMeasurableInput(): AnalysisInput {
  return makeInput({
    mintInfo: {
      ...makeInput().mintInfo,
      mintAuthority: "MintAuth1111111111111111111111111111111111",
      freezeAuthority: "FreezeAuth11111111111111111111111111111111",
      tokenProgram: "spl-token-2022",
      extensions: [
        { extension: "permanentDelegate", state: { delegate: "Delegate111111" } },
      ],
    },
    metadata: {
      ...makeInput().metadata,
      isMutable: true,
      updateAuthority: "UpdateAuth1111111111111111111111111111111",
    },
  });
}

describe("every measured signal carries well-formed evidence", () => {
  const report = build(fullyMeasurableInput());
  const measured = report.signals.filter((s) => s.status === "ok");

  it("produces a signal for every registered rule", () => {
    expect(report.signals).toHaveLength(RULES.length);
  });

  it("attaches at least one evidence item to every measured signal", () => {
    for (const signal of measured) {
      expect(signal.evidence.length, `${signal.id} has no evidence`).toBeGreaterThan(0);
    }
  });

  it("gives every evidence item a non-empty label and value", () => {
    for (const signal of measured) {
      for (const item of signal.evidence) {
        expect(item.label.trim(), `${signal.id} evidence label`).not.toBe("");
        expect(item.value.trim(), `${signal.id} evidence value`).not.toBe("");
      }
    }
  });

  it("only ever links to absolute https URLs", () => {
    for (const signal of report.signals) {
      for (const item of signal.evidence) {
        if (item.href === undefined) continue;
        const url = new URL(item.href);
        expect(url.protocol, `${signal.id} -> ${item.href}`).toBe("https:");
      }
    }
  });

  it("never repeats an evidence label within one signal", () => {
    for (const signal of measured) {
      const labels = signal.evidence.map((e) => e.label);
      // Holder rules legitimately list several "<pct> — <kind>" rows; those are
      // distinct labels, so an exact duplicate still indicates a bug.
      expect(new Set(labels).size, `${signal.id} duplicates an evidence label`).toBe(
        labels.length,
      );
    }
  });
});

describe("unavailable signals never imply a measurement happened", () => {
  /** Every provider failing at once: each rule must degrade, not fabricate. */
  const blindInput = makeInput({
    holderData: {
      available: false,
      holders: [],
      circulatingSupply: 0,
      pooledShare: 0,
      burnedShare: 0,
      effectiveTopHolderShare: null,
      verifiedLockedShare: 0,
      topHolderShare: null,
      top10Share: null,
      next9Share: null,
      error: "RPC rate limited",
    },
    marketData: {
      available: false,
      pairs: [],
      name: null,
      symbol: null,
      imageUrl: null,
      websites: [],
      socials: [],
      error: "provider down",
    },
    metadata: {
      name: null,
      symbol: null,
      uri: null,
      updateAuthority: null,
      isMutable: null,
      source: "none",
      metadataAccount: null,
    },
  });

  const report = build(blindInput);
  const unavailable = report.signals.filter((s) => s.status === "unavailable");

  it("marks the data-dependent rules unavailable when every provider fails", () => {
    // Authority rules read the mint account, which is always present, so they
    // stay measurable. Everything else must drop out.
    expect(unavailable.length).toBeGreaterThanOrEqual(9);
  });

  it("charges no points and reports a neutral observed value", () => {
    for (const signal of unavailable) {
      expect(signal.points, `${signal.id} charged points while unavailable`).toBe(0);
      expect(signal.observedValue).toBe("Not available");
      expect(signal.severity).toBe("none");
    }
  });

  it("explains why the measurement failed rather than asserting a finding", () => {
    for (const signal of unavailable) {
      expect(signal.explanation.length).toBeGreaterThan(20);
      // An unavailable signal must never read as a clean result.
      expect(signal.explanation.toLowerCase()).not.toMatch(
        /\b(is healthy|no concern|well-distributed|renounced)\b/,
      );
    }
  });

  it("keeps unavailable evidence descriptive of the failure, never of a value", () => {
    for (const signal of unavailable) {
      for (const item of signal.evidence) {
        // Evidence on an unavailable signal may explain the attempt (e.g. how
        // many signatures were scanned) but must not present a measured share.
        expect(item.value).not.toMatch(/of circulating supply/);
      }
    }
  });
});

describe("evidence supports the exact claim each signal makes", () => {
  it("mint authority evidence carries the authority address and a link", () => {
    const live = signalById(
      makeInput({
        mintInfo: { ...makeInput().mintInfo, mintAuthority: "MintAuthorityAddr11" },
      }),
      "mint-authority",
    );
    const entry = live.evidence.find((e) => e.label === "Mint authority");
    expect(entry?.value).toBe("MintAuthorityAddr11");
    expect(entry?.href).toContain("MintAuthorityAddr11");

    const renounced = signalById(makeInput(), "mint-authority");
    const none = renounced.evidence.find((e) => e.label === "Mint authority");
    expect(none?.value).toMatch(/null|renounced/i);
    expect(none?.href).toBeUndefined();
  });

  it("freeze authority evidence matches its own metric, not the mint authority", () => {
    const signal = signalById(
      makeInput({
        mintInfo: {
          ...makeInput().mintInfo,
          mintAuthority: "MintAuthorityAddr11",
          freezeAuthority: "FreezeAuthorityAddr22",
        },
      }),
      "freeze-authority",
    );
    const values = signal.evidence.map((e) => e.value).join(" ");
    expect(values).toContain("FreezeAuthorityAddr22");
    expect(values).not.toContain("MintAuthorityAddr11");
  });

  it("largest-holder evidence reports the same share as the observed value", () => {
    const signal = signalById(
      makeInput({
        holderData: { ...makeInput().holderData, topHolderShare: 0.3729, next9Share: 0.4331 },
      }),
      "top-holder",
    );
    expect(signal.observedValue).toContain("37.29%");
    const entry = signal.evidence.find((e) => e.label === "Largest holder");
    expect(entry?.value).toBe("37.29%");
  });

  it("holder-spread evidence reports the marginal share it scores, plus the top-10 context", () => {
    const signal = signalById(
      makeInput({
        holderData: {
          ...makeInput().holderData,
          effectiveTopHolderShare: null,
          verifiedLockedShare: 0,
          topHolderShare: 0.3729,
          next9Share: 0.4331,
          top10Share: 0.806,
        },
      }),
      "holder-spread",
    );
    expect(signal.observedValue).toContain("43.31%");
    expect(signal.evidence.find((e) => e.label === "Holders 2–10 combined")?.value).toBe(
      "43.31%",
    );
    // The familiar top-10 figure must be visible even though it is not scored.
    expect(signal.evidence.find((e) => e.label === "Top 10 combined")?.value).toBe("80.60%");
  });

  it("liquidity evidence totals the pools it claims to have summed", () => {
    const signal = signalById(
      makeInput({
        marketData: {
          ...makeInput().marketData,
          pairs: [
            pair({ liquidityUsd: 60_000, dexId: "raydium" }),
            pair({ liquidityUsd: 40_000, dexId: "orca" }),
          ],
        },
      }),
      "liquidity-depth",
    );
    expect(signal.evidence.find((e) => e.label === "Total liquidity")?.value).toBe("$100.00K");
    expect(signal.evidence.find((e) => e.label === "Pools")?.value).toBe("2");
    expect(signal.observedValue).toContain("2 pools");
  });

  it("pool-age evidence carries a parseable creation timestamp", () => {
    const created = Date.now() - 5 * 24 * 60 * 60 * 1000;
    const signal = signalById(
      makeInput({
        marketData: { ...makeInput().marketData, pairs: [pair({ pairCreatedAt: created })] },
      }),
      "pool-maturity",
    );
    const entry = signal.evidence.find((e) => e.label === "Oldest pool created");
    expect(entry).toBeDefined();
    expect(Number.isNaN(Date.parse(entry!.value))).toBe(false);
  });

  it("trading-activity evidence shows both inputs to the turnover ratio", () => {
    const signal = signalById(
      makeInput({
        marketData: {
          ...makeInput().marketData,
          pairs: [pair({ liquidityUsd: 100_000, volume24hUsd: 50_000 })],
        },
      }),
      "trading-activity",
    );
    expect(signal.evidence.find((e) => e.label === "24h volume")?.value).toBe("$50.00K");
    expect(signal.evidence.find((e) => e.label === "Total liquidity")?.value).toBe("$100.00K");
    expect(signal.evidence.find((e) => e.label === "Turnover ratio")?.value).toBe("0.500x");
  });

  it("records when the liquidity-ratio severity was capped, so the cap is auditable", () => {
    const capped = signalById(
      makeInput({
        marketData: {
          ...makeInput().marketData,
          pairs: [
            pair({ liquidityUsd: 40_000_000, marketCap: 60_000_000_000, fdv: 60_000_000_000 }),
          ],
        },
      }),
      "liquidity-ratio",
    );
    expect(capped.evidence.some((e) => e.label === "Severity capped")).toBe(true);

    const uncapped = signalById(makeInput(), "liquidity-ratio");
    expect(uncapped.evidence.some((e) => e.label === "Severity capped")).toBe(false);
  });

  it("does not leak another signal's metric into an unrelated signal's evidence", () => {
    const report = build(fullyMeasurableInput());
    const liquidity = report.signals.find((s) => s.id === "liquidity-depth")!;
    const labels = liquidity.evidence.map((e) => e.label.toLowerCase()).join(" ");
    expect(labels).not.toMatch(/authority|holder|volume|age/);
  });
});
