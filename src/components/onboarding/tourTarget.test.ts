import { describe, expect, it } from "vitest";

import {
  rectsOverlap,
  resolveTarget,
  shouldHighlight,
  type QueryRoot,
  type Rect,
} from "./tourTarget";

import { PRODUCT_TOUR } from "./tourSteps";

const rect = (left: number, top: number, width = 100, height = 50): Rect => ({
  left,
  top,
  width,
  height,
});

const root = (match: Element | null): QueryRoot => ({ querySelector: () => match });
const element = {} as Element;

describe("optional step targets", () => {
  it("resolves a target that exists", () => {
    expect(resolveTarget("[data-tour='analyser']", root(element))).toBe(element);
  });

  it("returns null when the step declares no target", () => {
    expect(resolveTarget(undefined, root(element))).toBeNull();
  });

  it("returns null when the target is absent from the page", () => {
    expect(resolveTarget("[data-tour='analyser']", root(null))).toBeNull();
  });

  it("returns null rather than throwing on an invalid selector", () => {
    const throwing: QueryRoot = {
      querySelector() {
        throw new SyntaxError("bad selector");
      },
    };
    expect(() => resolveTarget(":::", throwing)).not.toThrow();
    expect(resolveTarget(":::", throwing)).toBeNull();
  });

  it("returns null with no document, so server rendering is safe", () => {
    expect(resolveTarget("[data-tour='analyser']", null)).toBeNull();
  });
});

describe("highlight placement", () => {
  it("detects overlapping and separated rectangles", () => {
    expect(rectsOverlap(rect(0, 0), rect(50, 20))).toBe(true);
    expect(rectsOverlap(rect(0, 0), rect(200, 0))).toBe(false);
    expect(rectsOverlap(rect(0, 0), rect(0, 100))).toBe(false);
  });

  it("highlights a target that is clear of the dialog", () => {
    expect(shouldHighlight(rect(0, 0), rect(400, 400))).toBe(true);
  });

  it("skips a target the dialog would cover", () => {
    expect(shouldHighlight(rect(410, 410), rect(400, 400, 300, 300))).toBe(false);
  });

  it("skips when there is no target at all", () => {
    expect(shouldHighlight(null, rect(0, 0))).toBe(false);
  });

  it("skips a target with no size", () => {
    expect(shouldHighlight(rect(0, 0, 0, 0), null)).toBe(false);
  });

  it("highlights when the dialog has not been measured yet", () => {
    expect(shouldHighlight(rect(0, 0), null)).toBe(true);
  });
});

describe("tour content", () => {
  it("is short enough to stay an onboarding, not a tutorial", () => {
    expect(PRODUCT_TOUR.steps.length).toBeGreaterThanOrEqual(5);
    expect(PRODUCT_TOUR.steps.length).toBeLessThanOrEqual(7);
  });

  it("gives every step a unique id", () => {
    const ids = PRODUCT_TOUR.steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every step a real visual with described alt text and dimensions", () => {
    for (const step of PRODUCT_TOUR.steps) {
      expect(step.visual.src.startsWith("/tour/")).toBe(true);
      expect(step.visual.alt.length).toBeGreaterThan(20);
      expect(step.visual.width).toBeGreaterThan(0);
      expect(step.visual.height).toBeGreaterThan(0);
    }
  });

  it("keeps copy scannable", () => {
    for (const step of PRODUCT_TOUR.steps) {
      expect(step.title.length).toBeLessThanOrEqual(48);
      expect(step.description.length).toBeLessThanOrEqual(300);
    }
  });

  it("ends on an action rather than a bare Next", () => {
    const last = PRODUCT_TOUR.steps[PRODUCT_TOUR.steps.length - 1];
    expect(last.primaryLabel).toBe("Start exploring");
  });

  it("makes no safety guarantee anywhere in its copy", () => {
    const prose = PRODUCT_TOUR.steps
      .map((s) => `${s.title} ${s.description}`)
      .join(" ")
      .toLowerCase();
    expect(prose).not.toMatch(/guarantees? (that )?(a |the )?token is safe/);
    expect(prose).not.toMatch(/detects? (scams|fraud|rug)/);
    expect(prose).not.toMatch(/\bproves? (it is )?safe\b/);
  });
});
