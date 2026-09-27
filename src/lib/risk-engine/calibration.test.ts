import { describe, expect, it } from "vitest";

import { CATEGORY_WEIGHTS, aggregateScore, buildRiskReport } from "./engine";
import type { AnalysisInput } from "./input";
import type {
  CategoryScore,
  DataSourceStatus,
  RiskCategory,
  TokenOverview,
} from "./types";
import { RISK_CATEGORIES } from "./types";
import { ARCHETYPES, makeInput, pair } from "./test-fixtures";

/**
 * Calibration tests.
 *
 * These pin the *behaviour of the aggregation itself*, independently of any
 * single rule: that risk dimensions do not cancel each other out, that
 * correlated holder metrics cannot dominate, and that realistic token shapes
 * land in the intended bands. They are the guardrail against the scoring
 * quietly drifting back toward a flat average.
 */

const build = (input: AnalysisInput) =>
  buildRiskReport(input, {
    overview: {} as TokenOverview,
    sources: [] as DataSourceStatus[],
    elapsedMs: 0,
  });

/** Construct category scores directly, to test aggregation in isolation. */
function categories(ratios: Partial<Record<RiskCategory, number | null>>): CategoryScore[] {
  return RISK_CATEGORIES.map((category) => {
    // `?? 0` would coerce an explicit null (unmeasurable) into 0 (measured
    // clean), which is exactly the distinction these tests exist to check.
    const ratio = category in ratios ? (ratios[category] as number | null) : 0;
    return {
      category,
      points: ratio === null ? 0 : ratio * 100,
      maxPoints: ratio === null ? 0 : 100,
      percent: ratio === null ? null : Math.round(ratio * 100),
      signalCount: 2,
      weight: CATEGORY_WEIGHTS[category],
    };
  });
}

describe("aggregation is non-compensatory across risk dimensions", () => {
  it("does not let clean categories cancel a severe one", () => {
    // One dimension fully compromised, four spotless.
    const score = aggregateScore(categories({ Liquidity: 1 }))!;
    // A flat average would report 20 — "Moderate", which is the bug this
    // methodology exists to fix.
    expect(score).toBeGreaterThan(20);
    expect(score).toBe(45);
  });

  it("scales super-linearly as more dimensions fail", () => {
    const one = aggregateScore(categories({ Liquidity: 1 }))!;
    const two = aggregateScore(categories({ Liquidity: 1, Maturity: 1 }))!;
    const three = aggregateScore(categories({ Liquidity: 1, Maturity: 1, Holders: 1 }))!;
    const four = aggregateScore(
      categories({ Liquidity: 1, Maturity: 1, Holders: 1, Authorities: 1 }),
    )!;
    const five = aggregateScore(
      categories({
        Liquidity: 1,
        Maturity: 1,
        Holders: 1,
        Authorities: 1,
        "Market Activity": 1,
      }),
    )!;

    expect([one, two, three, four, five]).toEqual([45, 63, 77, 89, 100]);
  });

  it("caps a single compromised dimension below the High band", () => {
    // The documented guarantee: one bad dimension is never enough for "High".
    // Two are. This is what stops any one rule set from dominating the verdict.
    for (const category of RISK_CATEGORIES) {
      const score = aggregateScore(categories({ [category]: 1 }))!;
      expect(score, `${category} alone`).toBeLessThan(60);
    }
  });

  it("is monotonic: more risk in any dimension never lowers the score", () => {
    let previous = aggregateScore(categories({ Holders: 0 }))!;
    for (const ratio of [0.2, 0.4, 0.6, 0.8, 1]) {
      const next = aggregateScore(categories({ Holders: ratio }))!;
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
  });

  it("drops an unmeasurable category instead of scoring it clean", () => {
    const withClean = aggregateScore(categories({ Holders: 1, Liquidity: 0 }))!;
    const withMissing = aggregateScore(categories({ Holders: 1, Liquidity: null }))!;
    // Missing data must not make a token look safer than measured-and-clean.
    expect(withMissing).toBeGreaterThan(withClean);
  });

  it("returns null when nothing at all could be measured", () => {
    expect(
      aggregateScore(
        categories(
          Object.fromEntries(RISK_CATEGORIES.map((c) => [c, null])) as Record<
            RiskCategory,
            null
          >,
        ),
      ),
    ).toBeNull();
  });

  it("weights every category equally, so no category can be privileged", () => {
    const weights = Object.values(CATEGORY_WEIGHTS);
    expect(new Set(weights).size).toBe(1);

    // Swapping which category carries the risk must not change the score.
    const scores = RISK_CATEGORIES.map((c) => aggregateScore(categories({ [c]: 0.7 }))!);
    expect(new Set(scores).size).toBe(1);
  });
});

describe("correlated holder metrics cannot dominate the score", () => {
  /**
   * The regression this guards: top-1 and top-10 correlate at r = 0.92 on real
   * tokens because top-10 contains top-1. Scoring both charged one wallet
   * twice and reported it as two independent critical findings.
   */
  it("does not max the Holders category when concentration is a single wallet", () => {
    const report = build(ARCHETYPES.singleWhale());
    const holders = report.categories.find((c) => c.category === "Holders")!;

    const topHolder = report.signals.find((s) => s.id === "top-holder")!;
    const spread = report.signals.find((s) => s.id === "holder-spread")!;

    // The single-actor risk is real and fully charged...
    expect(topHolder.severity).toBe("critical");
    expect(topHolder.points).toBe(topHolder.maxPoints);
    // ...but the nine wallets behind it hold only 15.2%, which is not a bloc.
    expect(spread.severity).toBe("none");
    expect(spread.points).toBe(0);

    // So the category must not read as 100% compromised.
    expect(holders.percent).toBeLessThan(100);
    expect(holders.percent).toBeGreaterThan(50);
  });

  it("separates single-actor risk from coordinated risk", () => {
    const whaleOnly = build(
      makeInput({
        holderData: {
          ...makeInput().holderData,
          topHolderShare: 0.7,
          next9Share: 0.05,
          top10Share: 0.75,
        },
      }),
    );
    const blocOnly = build(
      makeInput({
        holderData: {
          ...makeInput().holderData,
          topHolderShare: 0.04,
          next9Share: 0.7,
          top10Share: 0.74,
        },
      }),
    );

    const sev = (r: ReturnType<typeof build>, id: string) =>
      r.signals.find((s) => s.id === id)!.severity;

    // Near-identical top-10 totals, opposite shapes, opposite findings.
    expect(sev(whaleOnly, "top-holder")).toBe("critical");
    expect(sev(whaleOnly, "holder-spread")).toBe("none");
    expect(sev(blocOnly, "top-holder")).toBe("none");
    expect(sev(blocOnly, "holder-spread")).toBe("critical");
  });

  it("keeps maximal holder concentration from reaching High on its own", () => {
    const report = build(
      makeInput({
        holderData: {
          ...makeInput().holderData,
          topHolderShare: 0.95,
          next9Share: 0.04,
          top10Share: 0.99,
        },
      }),
    );
    // Everything else about this token is healthy, so concentration alone must
    // not produce a High verdict — it is one dimension of five.
    expect(report.score!).toBeLessThan(60);
    expect(report.summary.topConcerns[0].id).toBe("top-holder");
  });
});

describe("archetypes land in their intended bands", () => {
  const scoreOf = (input: AnalysisInput) => build(input).score!;

  it("scores a healthy blue chip Low", () => {
    const report = build(ARCHETYPES.healthyBlueChip());
    expect(report.score!).toBeLessThan(20);
    expect(report.classification).toBe("Low Risk Signals");
  });

  it("scores a custodial stablecoin as a real but moderate signal set", () => {
    const report = build(ARCHETYPES.custodialStablecoin());
    // Retained mint and freeze authority are genuine control risks and must
    // register — but deep liquidity and a long history must keep it out of High.
    expect(report.score!).toBeGreaterThan(20);
    expect(report.score!).toBeLessThan(60);
  });

  it("scores a days-old, low-liquidity token Elevated with pool-only maturity", () => {
    const report = build(ARCHETYPES.freshLowLiquidity());
    // Removing the second age term changes this fixture, not the score bands.
    expect(report.score).toBe(59);
    expect(report.classification).toBe("Elevated Risk Signals");
  });

  it("scores a token with every red flag Critical", () => {
    const report = build(ARCHETYPES.everyRedFlag());
    expect(report.score!).toBeGreaterThanOrEqual(80);
    expect(report.classification).toBe("Critical Risk Signals");
  });

  it("orders the archetypes exactly as their risk increases", () => {
    expect(scoreOf(ARCHETYPES.healthyBlueChip())).toBeLessThan(
      scoreOf(ARCHETYPES.custodialStablecoin()),
    );
    expect(scoreOf(ARCHETYPES.custodialStablecoin())).toBeLessThan(
      scoreOf(ARCHETYPES.freshLowLiquidity()),
    );
    expect(scoreOf(ARCHETYPES.freshLowLiquidity())).toBeLessThan(
      scoreOf(ARCHETYPES.everyRedFlag()),
    );
  });

  it("separates an established token from a fresh one by a wide margin", () => {
    // The concrete failure of the previous flat-average scoring: a one-day-old
    // token with almost no liquidity scored 40, and USDT scored 41.
    const gap =
      scoreOf(ARCHETYPES.freshLowLiquidity()) - scoreOf(ARCHETYPES.custodialStablecoin());
    expect(gap).toBeGreaterThan(20);
  });
});

describe("deterministic summary", () => {
  it("counts every signal into exactly one severity bucket", () => {
    const report = build(ARCHETYPES.everyRedFlag());
    const { counts } = report.summary;
    const total =
      counts.critical + counts.high + counts.medium + counts.low + counts.none + counts.unavailable;
    expect(total).toBe(report.signals.length);
  });

  it("ranks concerns by their actual contribution to the score", () => {
    const report = build(ARCHETYPES.freshLowLiquidity());
    const concerns = report.summary.topConcerns;

    expect(concerns.length).toBeGreaterThan(0);
    expect(concerns.length).toBeLessThanOrEqual(3);

    const pointsOf = (id: string) => report.signals.find((s) => s.id === id)!.points;
    for (let i = 1; i < concerns.length; i += 1) {
      expect(pointsOf(concerns[i - 1].id)).toBeGreaterThanOrEqual(pointsOf(concerns[i].id));
    }
    // Never surface a clean signal as a concern.
    for (const concern of concerns) expect(concern.severity).not.toBe("none");
  });

  it("names drivers and offsets, and reads as a sentence", () => {
    const report = build(ARCHETYPES.freshLowLiquidity());
    const { rationale, drivers, offsets } = report.summary;

    expect(drivers).toContain("Maturity");
    expect(offsets).toContain("Authorities");
    expect(rationale).toMatch(/partially offset by/);
    expect(rationale.endsWith(".")).toBe(true);
  });

  it("says so plainly when nothing fired", () => {
    const report = build(ARCHETYPES.healthyBlueChip());
    expect(report.summary.topConcerns.length).toBeLessThanOrEqual(3);
    expect(report.summary.rationale.length).toBeGreaterThan(10);
    expect(report.summary.rationale.endsWith(".")).toBe(true);
  });

  it("is deterministic across repeated builds", () => {
    const input = ARCHETYPES.freshLowLiquidity();
    const a = build(input);
    const b = build(input);
    expect(a.summary.rationale).toBe(b.summary.rationale);
    expect(a.summary.topConcerns).toEqual(b.summary.topConcerns);
    expect(a.score).toBe(b.score);
  });

  it("never claims an offset when no category is clean", () => {
    const report = build(ARCHETYPES.everyRedFlag());
    if (report.summary.offsets.length === 0) {
      expect(report.summary.rationale).not.toMatch(/offset/);
    }
  });
});

describe("score stays within bounds under hostile inputs", () => {
  it("handles a zero-supply mint without dividing by zero", () => {
    const report = build(
      makeInput({
        mintInfo: {
          ...makeInput().mintInfo,
          supplyRaw: "0",
          supplyUi: 0,
          supplyIsMeaningful: false,
        },
      }),
    );
    expect(Number.isFinite(report.score ?? 0)).toBe(true);
  });

  it("handles zero liquidity and zero volume without producing NaN", () => {
    const report = build(
      makeInput({
        marketData: {
          ...makeInput().marketData,
          pairs: [pair({ liquidityUsd: 0, volume24hUsd: 0, marketCap: 0, fdv: 0 })],
        },
      }),
    );
    expect(report.score).not.toBeNull();
    expect(Number.isNaN(report.score!)).toBe(false);
    for (const signal of report.signals) {
      expect(Number.isNaN(signal.points)).toBe(false);
    }
  });

  it("keeps every category percentage within 0-100", () => {
    for (const make of Object.values(ARCHETYPES)) {
      const report = build(make());
      for (const category of report.categories) {
        if (category.percent === null) continue;
        expect(category.percent).toBeGreaterThanOrEqual(0);
        expect(category.percent).toBeLessThanOrEqual(100);
      }
      expect(report.score!).toBeGreaterThanOrEqual(0);
      expect(report.score!).toBeLessThanOrEqual(100);
    }
  });
});
