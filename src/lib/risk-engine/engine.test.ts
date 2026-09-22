import { describe, expect, it } from "vitest";

import { RULES, buildRiskReport, classifyScore } from "./engine";
import { classify, classifyDescending, pointsFor, type Band } from "./helpers";
import type { AnalysisInput } from "./input";
import type { DataSourceStatus, TokenOverview } from "./types";
import { DAY, makeInput, pair } from "./test-fixtures";

/**
 * The risk engine is pure: every rule is a function of fetched data to a
 * signal, with no clock, no randomness and no I/O. That is what makes the
 * scoring auditable, and it is also what makes it testable without a network —
 * these tests construct synthetic inputs and assert on exact outcomes.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OVERVIEW = {} as TokenOverview;
const SOURCES: DataSourceStatus[] = [];
const build = (input: AnalysisInput) =>
  buildRiskReport(input, { overview: OVERVIEW, sources: SOURCES, elapsedMs: 0 });

const signalById = (input: AnalysisInput, id: string) => {
  const found = build(input).signals.find((s) => s.id === id);
  if (!found) throw new Error(`no signal with id "${id}"`);
  return found;
};

// ---------------------------------------------------------------------------

describe("threshold helpers", () => {
  const bands: readonly Band[] = [
    [10, "none"],
    [20, "medium"],
    [Infinity, "critical"],
  ];

  it("classifies ascending bands on the low side of each boundary", () => {
    expect(classify(9.99, bands)).toBe("none");
    expect(classify(10, bands)).toBe("medium"); // boundary belongs to the next band
    expect(classify(19.99, bands)).toBe("medium");
    expect(classify(20, bands)).toBe("critical");
  });

  it("classifies descending bands where higher is safer", () => {
    const descending: readonly Band[] = [
      [100, "none"],
      [50, "medium"],
      [-Infinity, "critical"],
    ];
    expect(classifyDescending(200, descending)).toBe("none");
    expect(classifyDescending(100, descending)).toBe("medium");
    expect(classifyDescending(60, descending)).toBe("medium");
    expect(classifyDescending(10, descending)).toBe("critical");
  });

  it("charges a fixed fraction of weight per severity", () => {
    expect(pointsFor("none", 20)).toBe(0);
    expect(pointsFor("low", 20)).toBe(5);
    expect(pointsFor("medium", 20)).toBe(10);
    expect(pointsFor("high", 20)).toBe(16);
    expect(pointsFor("critical", 20)).toBe(20);
  });
});

describe("authority rules", () => {
  it("charges full weight for a live mint authority and nothing when renounced", () => {
    const live = signalById(
      makeInput({
        mintInfo: { ...makeInput().mintInfo, mintAuthority: "AuthorityPubkey1111" },
      }),
      "mint-authority",
    );
    expect(live.severity).toBe("critical");
    expect(live.points).toBe(live.maxPoints);

    const renounced = signalById(makeInput(), "mint-authority");
    expect(renounced.severity).toBe("none");
    expect(renounced.points).toBe(0);
  });

  it("flags a Token-2022 permanent delegate as critical", () => {
    const signal = signalById(
      makeInput({
        mintInfo: {
          ...makeInput().mintInfo,
          tokenProgram: "spl-token-2022",
          extensions: [
            { extension: "permanentDelegate", state: { delegate: "Delegate1111" } },
          ],
        },
      }),
      "token-extensions",
    );
    expect(signal.severity).toBe("critical");
    expect(signal.observedValue).toContain("Permanent delegate");
  });

  it("does not penalise a Token-2022 mint whose extensions are informational", () => {
    const signal = signalById(
      makeInput({
        mintInfo: {
          ...makeInput().mintInfo,
          tokenProgram: "spl-token-2022",
          extensions: [
            { extension: "metadataPointer", state: { metadataAddress: "x" } },
            {
              extension: "transferFeeConfig",
              state: { newerTransferFee: { transferFeeBasisPoints: 0 } },
            },
          ],
        },
      }),
      "token-extensions",
    );
    expect(signal.severity).toBe("none");
    expect(signal.points).toBe(0);
  });

  it("escalates a large transfer fee above a small one", () => {
    const withFee = (bps: number) =>
      signalById(
        makeInput({
          mintInfo: {
            ...makeInput().mintInfo,
            tokenProgram: "spl-token-2022",
            extensions: [
              {
                extension: "transferFeeConfig",
                state: { newerTransferFee: { transferFeeBasisPoints: bps } },
              },
            ],
          },
        }),
        "token-extensions",
      );
    expect(withFee(100).severity).toBe("medium");
    expect(withFee(900).severity).toBe("high");
  });
});

describe("holder rules", () => {
  it("scales severity with concentration", () => {
    const at = (topHolderShare: number) =>
      signalById(
        makeInput({
          holderData: { ...makeInput().holderData, topHolderShare },
        }),
        "top-holder",
      ).severity;

    expect(at(0.01)).toBe("none");
    expect(at(0.07)).toBe("low");
    expect(at(0.15)).toBe("medium");
    expect(at(0.3)).toBe("high");
    expect(at(0.8)).toBe("critical");
  });

  it("scores a verified freeze on the liquid share, without hiding the raw figure", () => {
    const signal = signalById(
      makeInput({
        holderData: {
          ...makeInput().holderData,
          topHolderShare: 0.5,
          effectiveTopHolderShare: 0.12,
          verifiedLockedShare: 0.38,
        },
      }),
      "top-holder",
    );

    // Severity follows what could be sold...
    expect(signal.severity).toBe("medium");
    // ...but the headline stays the real position size.
    expect(signal.observedValue).toBe("50.00% of circulating supply");
    expect(signal.evidence.find((e) => e.label === "Largest liquid position")?.value).toBe(
      "12.00% of circulating supply",
    );
  });

  it("never lets a freeze on one holder mask a liquid position on another", () => {
    // Effective liquid concentration is the largest *sellable* position, so a
    // heavily frozen number-one holder cannot drag the score below a fully
    // liquid number two.
    const signal = signalById(
      makeInput({
        holderData: {
          ...makeInput().holderData,
          topHolderShare: 0.5,
          effectiveTopHolderShare: 0.3,
          verifiedLockedShare: 0.45,
        },
      }),
      "top-holder",
    );
    expect(signal.severity).toBe("high");
  });

  it("does not claim a lock when nothing was verified", () => {
    const signal = signalById(
      makeInput({
        holderData: {
          ...makeInput().holderData,
          topHolderShare: 0.3,
          effectiveTopHolderShare: 0.3,
          verifiedLockedShare: 0,
        },
      }),
      "top-holder",
    );

    expect(signal.explanation).not.toContain("frozen");
    expect(signal.evidence.some((e) => e.label === "Verified locked")).toBe(false);
  });

  it("excludes holder signals from the score when data is unavailable", () => {
    const report = build(
      makeInput({
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
          error: "rate limited",
        },
      }),
    );

    const holderSignals = report.signals.filter((s) => s.category === "Holders");
    expect(holderSignals).toHaveLength(2);
    for (const signal of holderSignals) {
      expect(signal.status).toBe("unavailable");
      expect(signal.points).toBe(0);
    }
    // Their weight must leave the denominator, not sit in it scoring zero.
    expect(report.availableWeight).toBe(report.totalWeight - 28);
  });
});

describe("liquidity rules", () => {
  it("treats a token with no pools as critical", () => {
    const signal = signalById(
      makeInput({
        marketData: { ...makeInput().marketData, pairs: [] },
      }),
      "liquidity-depth",
    );
    expect(signal.severity).toBe("critical");
    expect(signal.observedValue).toBe("No DEX pools found");
  });

  it("caps the liquidity-ratio severity when absolute depth is ample", () => {
    // A mega-cap with a tiny ratio but tens of millions of real depth.
    const signal = signalById(
      makeInput({
        marketData: {
          ...makeInput().marketData,
          pairs: [
            pair({
              liquidityUsd: 40_000_000,
              marketCap: 60_000_000_000,
              fdv: 60_000_000_000,
            }),
          ],
        },
      }),
      "liquidity-ratio",
    );
    // Raw ratio is ~0.07%, which alone would be critical.
    expect(signal.severity).toBe("low");
    expect(signal.evidence.some((e) => e.label === "Severity capped")).toBe(true);
  });

  it("still penalises a thin ratio when absolute depth is small", () => {
    const signal = signalById(
      makeInput({
        marketData: {
          ...makeInput().marketData,
          pairs: [pair({ liquidityUsd: 20_000, marketCap: 50_000_000, fdv: 50_000_000 })],
        },
      }),
      "liquidity-ratio",
    );
    expect(signal.severity).toBe("critical");
  });

  it("flags a single-pool market", () => {
    const signal = signalById(
      makeInput({
        marketData: { ...makeInput().marketData, pairs: [pair({ liquidityUsd: 50_000 })] },
      }),
      "pool-diversity",
    );
    expect(signal.severity).toBe("medium");
    expect(signal.explanation).toContain("single pool");
  });
});

describe("market activity rules", () => {
  it("flags both a dead market and an implausibly hot one", () => {
    const turnover = (volume24hUsd: number) =>
      signalById(
        makeInput({
          marketData: {
            ...makeInput().marketData,
            pairs: [pair({ liquidityUsd: 100_000, volume24hUsd })],
          },
        }),
        "trading-activity",
      );

    expect(turnover(0).severity).toBe("high"); // no trades at all
    expect(turnover(500).severity).toBe("high"); // 0.5% turnover — dormant
    expect(turnover(50_000).severity).toBe("none"); // healthy
    expect(turnover(5_000_000).severity).toBe("high"); // 50x — wash-trade shaped
  });

  it("ignores the buy/sell ratio when there are too few trades to be meaningful", () => {
    const signal = signalById(
      makeInput({
        marketData: {
          ...makeInput().marketData,
          pairs: [pair({ buys24h: 1, sells24h: 9 })],
        },
      }),
      "trade-imbalance",
    );
    expect(signal.status).toBe("unavailable");
    expect(signal.points).toBe(0);
  });

  it("scores a large price move the same in either direction", () => {
    const change = (priceChange24h: number) =>
      signalById(
        makeInput({
          marketData: { ...makeInput().marketData, pairs: [pair({ priceChange24h })] },
        }),
        "price-volatility",
      ).severity;

    expect(change(90)).toBe("critical");
    expect(change(-90)).toBe("critical");
    expect(change(3)).toBe("none");
  });
});

describe("maturity rules", () => {
  it("flags a brand-new pool as critical", () => {
    const signal = signalById(
      makeInput({
        marketData: {
          ...makeInput().marketData,
          pairs: [pair({ pairCreatedAt: Date.now() - 2 * 60 * 60 * 1000 })],
        },
      }),
      "pool-maturity",
    );
    expect(signal.severity).toBe("critical");
  });

  it("reports token age as unmeasured when history was truncated", () => {
    // Regression guard: a busy token's newest 2000 signatures say nothing about
    // its age, and must never be read as "minutes old".
    const signal = signalById(
      makeInput({
        tokenAge: {
          available: true,
          oldestSignatureAt: Date.now() - 60 * 60 * 1000,
          ageDays: 0.04,
          isLowerBound: true,
          signaturesScanned: 2000,
        },
      }),
      "mint-age",
    );
    expect(signal.status).toBe("unavailable");
    expect(signal.points).toBe(0);
  });

  it("scores an exactly-resolved young mint as critical", () => {
    const signal = signalById(
      makeInput({
        tokenAge: {
          available: true,
          oldestSignatureAt: Date.now() - 2 * DAY,
          ageDays: 2,
          isLowerBound: false,
          signaturesScanned: 42,
        },
      }),
      "mint-age",
    );
    expect(signal.severity).toBe("critical");
  });
});

describe("report aggregation", () => {
  it("is deterministic: identical inputs give an identical score", () => {
    const input = makeInput();
    expect(build(input).score).toBe(build(input).score);
  });

  it("returns a clean, low score for a healthy token", () => {
    const report = build(makeInput());
    expect(report.score).toBeLessThan(15);
    expect(report.classification).toBe("Low Risk Signals");
    expect(report.coveragePercent).toBe(100);
  });

  it("returns a high score for a token with every red flag", () => {
    const report = build(
      makeInput({
        mintInfo: {
          ...makeInput().mintInfo,
          mintAuthority: "Deployer1111",
          freezeAuthority: "Deployer1111",
          tokenProgram: "spl-token-2022",
          extensions: [
            { extension: "permanentDelegate", state: { delegate: "Deployer1111" } },
          ],
        },
        metadata: { ...makeInput().metadata, isMutable: true, updateAuthority: "Deployer1111" },
        holderData: {
          ...makeInput().holderData,
          effectiveTopHolderShare: null,
          verifiedLockedShare: 0,
          topHolderShare: 0.6,
          top10Share: 0.95,
          next9Share: 0.35,
        },
        tokenAge: {
          available: true,
          oldestSignatureAt: Date.now() - 0.5 * DAY,
          ageDays: 0.5,
          isLowerBound: false,
          signaturesScanned: 30,
        },
        marketData: {
          ...makeInput().marketData,
          pairs: [
            pair({
              liquidityUsd: 3_000,
              volume24hUsd: 400_000,
              marketCap: 40_000_000,
              fdv: 40_000_000,
              pairCreatedAt: Date.now() - 2 * 60 * 60 * 1000,
              priceChange24h: -92,
              buys24h: 40,
              sells24h: 600,
            }),
          ],
        },
      }),
    );

    expect(report.score).toBeGreaterThan(80);
    expect(report.classification).toBe("Critical Risk Signals");
  });

  it("never lets a signal charge more than its weight, or an unavailable one charge at all", () => {
    for (const report of [build(makeInput()), build(makeInput({ marketData: { available: false, pairs: [], name: null, symbol: null, imageUrl: null, websites: [], socials: [], error: "down" } }))]) {
      for (const signal of report.signals) {
        expect(signal.points).toBeGreaterThanOrEqual(0);
        expect(signal.points).toBeLessThanOrEqual(signal.maxPoints);
        if (signal.status === "unavailable") expect(signal.points).toBe(0);
      }
    }
  });

  it("refuses to publish a score when coverage is too thin", () => {
    const report = build(
      makeInput({
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
          error: "unavailable",
        },
        tokenAge: {
          available: false,
          oldestSignatureAt: null,
          ageDays: null,
          isLowerBound: false,
          signaturesScanned: 0,
          error: "unavailable",
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
      }),
    );

    expect(report.score).toBeNull();
    expect(report.classification).toBe("Insufficient Data");
    expect(report.warnings.join(" ")).toContain("too little");
  });

  it("gives every rule a unique id and a non-empty explanation", () => {
    const report = build(makeInput());
    expect(report.signals).toHaveLength(RULES.length);
    expect(new Set(report.signals.map((s) => s.id)).size).toBe(RULES.length);
    for (const signal of report.signals) {
      expect(signal.metric.length).toBeGreaterThan(0);
      expect(signal.explanation.length).toBeGreaterThan(0);
      expect(signal.observedValue.length).toBeGreaterThan(0);
    }
  });

  it("maps scores onto classification bands at the documented boundaries", () => {
    expect(classifyScore(0, true)).toBe("Low Risk Signals");
    expect(classifyScore(19, true)).toBe("Low Risk Signals");
    expect(classifyScore(20, true)).toBe("Moderate Risk Signals");
    expect(classifyScore(39, true)).toBe("Moderate Risk Signals");
    expect(classifyScore(40, true)).toBe("Elevated Risk Signals");
    expect(classifyScore(59, true)).toBe("Elevated Risk Signals");
    expect(classifyScore(60, true)).toBe("High Risk Signals");
    expect(classifyScore(79, true)).toBe("High Risk Signals");
    expect(classifyScore(80, true)).toBe("Critical Risk Signals");
    expect(classifyScore(100, true)).toBe("Critical Risk Signals");
    expect(classifyScore(50, false)).toBe("Insufficient Data");
    expect(classifyScore(null, true)).toBe("Insufficient Data");
  });
});
