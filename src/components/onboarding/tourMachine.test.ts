import { describe, expect, it } from "vitest";

import {
  initialTourState,
  isFirstStep,
  isLastStep,
  progressLabel,
  tourReducer,
  type TourState,
} from "./tourMachine";

const TOTAL = 6;
const open = (index: number): TourState => ({ open: true, index });

describe("tour navigation", () => {
  it("starts closed, so nothing renders before the first-visit check runs", () => {
    expect(initialTourState).toEqual({ open: false, index: 0 });
  });

  it("opens at the first step", () => {
    expect(tourReducer(initialTourState, { type: "start" })).toEqual({
      open: true,
      index: 0,
    });
  });

  it("advances one step at a time", () => {
    let state = tourReducer(initialTourState, { type: "start" });
    state = tourReducer(state, { type: "next", total: TOTAL });
    expect(state.index).toBe(1);
    state = tourReducer(state, { type: "next", total: TOTAL });
    expect(state.index).toBe(2);
  });

  it("goes back one step at a time", () => {
    const state = tourReducer(open(3), { type: "back" });
    expect(state).toEqual({ open: true, index: 2 });
  });

  it("never moves before the first step", () => {
    expect(tourReducer(open(0), { type: "back" }).index).toBe(0);
  });

  it("never moves past the last step", () => {
    expect(tourReducer(open(TOTAL - 1), { type: "next", total: TOTAL }).index).toBe(
      TOTAL - 1,
    );
  });

  it("closes on dismiss", () => {
    expect(tourReducer(open(2), { type: "dismiss" }).open).toBe(false);
  });

  it("ignores navigation while closed, so a stray arrow key cannot reopen it", () => {
    const closed: TourState = { open: false, index: 2 };
    expect(tourReducer(closed, { type: "next", total: TOTAL })).toBe(closed);
    expect(tourReducer(closed, { type: "back" })).toBe(closed);
  });

  it("reopens from the first step when replayed after finishing", () => {
    const finished = tourReducer(open(TOTAL - 1), { type: "dismiss" });
    expect(tourReducer(finished, { type: "start" })).toEqual({ open: true, index: 0 });
  });

  it("survives a zero-step tour without producing a negative index", () => {
    expect(tourReducer(open(0), { type: "next", total: 0 }).index).toBe(0);
  });
});

describe("tour progress", () => {
  it("reports the first and last positions", () => {
    expect(isFirstStep(0)).toBe(true);
    expect(isFirstStep(1)).toBe(false);
    expect(isLastStep(TOTAL - 1, TOTAL)).toBe(true);
    expect(isLastStep(0, TOTAL)).toBe(false);
  });

  it("labels position one-based", () => {
    expect(progressLabel(0, TOTAL)).toBe("1 / 6");
    expect(progressLabel(5, TOTAL)).toBe("6 / 6");
  });

  it("never labels past the end", () => {
    expect(progressLabel(9, TOTAL)).toBe("6 / 6");
  });
});
