import { describe, expect, it } from "vitest";

import { toUiAmount } from "./amounts";

/**
 * Decimal regression suite.
 *
 * A mistake here is not a rounding error, it is a factor of a thousand: the
 * same arithmetic converts supply, holder balances and every share derived
 * from them. These cases pin the conversion at the boundaries where a naive
 * float implementation goes wrong.
 */
describe("raw SPL amounts to UI amounts", () => {
  it("passes through when a mint has no decimals", () => {
    expect(toUiAmount("1000", 0)).toBe(1000);
    expect(toUiAmount("0", 0)).toBe(0);
  });

  it("converts the common decimal scales exactly", () => {
    // 1 token at 6, 8 and 9 decimals.
    expect(toUiAmount("1000000", 6)).toBe(1);
    expect(toUiAmount("100000000", 8)).toBe(1);
    expect(toUiAmount("1000000000", 9)).toBe(1);
  });

  it("keeps sub-unit amounts, rather than truncating to zero", () => {
    expect(toUiAmount("1", 9)).toBeCloseTo(1e-9, 18);
    expect(toUiAmount("500000", 6)).toBe(0.5);
    expect(toUiAmount("250000000", 9)).toBe(0.25);
  });

  it("pads correctly when the raw amount is shorter than the decimal scale", () => {
    // The classic off-by-orders bug: "5" at 9 decimals is 0.000000005, not 5.
    expect(toUiAmount("5", 9)).toBeCloseTo(5e-9, 18);
    expect(toUiAmount("12", 6)).toBeCloseTo(0.000012, 12);
  });

  it("survives supplies beyond what a 64-bit float counts exactly", () => {
    // BONK-scale: ~88 trillion tokens at 5 decimals.
    expect(toUiAmount("8799440000000000000", 5)).toBeCloseTo(87_994_400_000_000, 0);
    // A full u64 at 9 decimals must not overflow into nonsense.
    const max = toUiAmount("18446744073709551615", 9);
    expect(Number.isFinite(max)).toBe(true);
    expect(max).toBeCloseTo(18_446_744_073.709551615, 0);
  });

  it("is monotonic across a decimal boundary", () => {
    // Two amounts one unit apart must stay one unit apart after conversion.
    const a = toUiAmount("999999999999", 6);
    const b = toUiAmount("1000000000000", 6);
    expect(b - a).toBeCloseTo(0.000001, 9);
  });

  it("never confuses the decimal count for a divisor", () => {
    // Dividing by `decimals` instead of 10**decimals is the other classic
    // failure; at 9 decimals it would return 1e8 rather than 1.
    expect(toUiAmount("1000000000", 9)).not.toBe(1_000_000_000 / 9);
    expect(toUiAmount("1000000000", 9)).toBe(1);
  });
});
