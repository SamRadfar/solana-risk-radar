import { describe, expect, it } from "vitest";

import { interpretCategories } from "./interpretation";
import type { CategoryScore, RiskCategory } from "./risk-engine/types";

/**
 * The interpretation sentence is shown to a reader as an explanation of the
 * verdict, so it has to be exactly as deterministic as the score it describes.
 * These tests pin the wording for each shape a result can take, and pin the
 * arithmetic that the wording quotes.
 */

const category = (
  name: RiskCategory,
  points: number,
  percent: number | null,
  signalCount = 3,
): CategoryScore => ({
  category: name,
  points,
  maxPoints: 20,
  percent,
  signalCount,
  weight: 20,
});

describe("interpretCategories", () => {
  it("names a single dominant category as nearly all of the risk", () => {
    const result = interpretCategories([
      category("Holders", 18, 90),
      category("Liquidity", 1, 5),
      category("Authorities", 0, 0),
      category("Market Activity", 0, 0),
      category("Maturity", 0, 0),
    ]);

    expect(result.sentence).toBe(
      "Nearly all of the measured risk came from holder concentration, at 95% of " +
        "everything charged, while authority, market-activity and maturity signals stayed clean.",
    );
  });

  it("names two leaders when neither dominates alone", () => {
    const result = interpretCategories([
      category("Holders", 10, 50),
      category("Market Activity", 8, 40),
      category("Liquidity", 2, 10),
      category("Authorities", 0, 0),
      category("Maturity", 0, 0),
    ]);

    expect(result.sentence).toBe(
      "Most of the measured risk came from holder concentration and trading-activity risk " +
        "— together 90% of everything charged, while authority and maturity signals stayed clean.",
    );
  });

  it("describes an evenly spread result as spread rather than led", () => {
    const result = interpretCategories([
      category("Holders", 5, 25),
      category("Liquidity", 5, 25),
      category("Market Activity", 4, 20),
      category("Maturity", 4, 20),
      category("Authorities", 2, 10),
    ]);

    expect(result.sentence).toContain("spread across 5 categories rather than concentrated in one");
    expect(result.sentence).toContain("led by holder concentration at 25%");
  });

  it("points at the negligible tail when nothing is fully clean", () => {
    const result = interpretCategories([
      category("Holders", 16, 80),
      category("Liquidity", 3, 15),
      category("Authorities", 1, 5),
      category("Market Activity", 1, 5),
      category("Maturity", 1, 5),
    ]);

    expect(result.sentence).toContain("contributed comparatively little");
    expect(result.sentence).not.toContain("stayed clean");
  });

  it("says so plainly when every category came back clean", () => {
    const result = interpretCategories([
      category("Holders", 0, 0),
      category("Liquidity", 0, 0),
      category("Authorities", 0, 0),
      category("Market Activity", 0, 0),
      category("Maturity", 0, 0),
    ]);

    expect(result.totalPoints).toBe(0);
    expect(result.sentence).toBe("Every category came back clean, so no category shaped the score.");
  });

  it("distinguishes clean-but-partial from clean-and-complete", () => {
    const result = interpretCategories([
      category("Holders", 0, 0),
      category("Liquidity", 0, null),
    ]);

    expect(result.unmeasured).toEqual(["Liquidity"]);
    expect(result.sentence).toBe(
      "Every category that could be measured came back clean, so none of them shaped the score.",
    );
  });

  it("attributes nothing when nothing could be measured", () => {
    const result = interpretCategories([
      category("Holders", 0, null),
      category("Liquidity", 0, null),
    ]);

    expect(result.contributions).toEqual([]);
    expect(result.sentence).toBe(
      "No category could be measured, so there is no risk to attribute.",
    );
  });

  it("excludes unmeasured categories from the attribution entirely", () => {
    const result = interpretCategories([
      category("Holders", 10, 50),
      category("Maturity", 0, null),
    ]);

    expect(result.contributions.map((c) => c.category)).toEqual(["Holders"]);
    expect(result.unmeasured).toEqual(["Maturity"]);
    expect(result.contributions[0].sharePercent).toBe(100);
  });

  it("reports whole percents that sum to exactly 100", () => {
    // Three equal thirds is the classic case where naive rounding gives 99.
    const result = interpretCategories([
      category("Holders", 1, 5),
      category("Liquidity", 1, 5),
      category("Authorities", 1, 5),
    ]);

    const total = result.contributions.reduce((sum, c) => sum + c.sharePercent, 0);
    expect(total).toBe(100);
    expect(result.contributions.map((c) => c.sharePercent).sort()).toEqual([33, 33, 34]);
  });

  it("orders contributions by points, largest first", () => {
    const result = interpretCategories([
      category("Maturity", 2, 10),
      category("Holders", 9, 45),
      category("Liquidity", 5, 25),
    ]);

    expect(result.contributions.map((c) => c.category)).toEqual([
      "Holders",
      "Liquidity",
      "Maturity",
    ]);
  });

  it("breaks ties deterministically rather than by input order", () => {
    const forward = interpretCategories([category("Maturity", 5, 25), category("Holders", 5, 25)]);
    const reversed = interpretCategories([category("Holders", 5, 25), category("Maturity", 5, 25)]);

    expect(forward.contributions.map((c) => c.category)).toEqual(
      reversed.contributions.map((c) => c.category),
    );
    expect(forward.sentence).toBe(reversed.sentence);
  });

  it("keeps exact shares for geometry alongside rounded ones for display", () => {
    const result = interpretCategories([
      category("Holders", 2, 10),
      category("Liquidity", 1, 5),
    ]);

    expect(result.contributions[0].share).toBeCloseTo(2 / 3, 10);
    expect(result.contributions[0].sharePercent).toBe(67);
  });
});
