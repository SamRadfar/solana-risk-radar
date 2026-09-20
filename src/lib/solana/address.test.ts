import { describe, expect, it } from "vitest";

import { decodeBase58, shortenAddress, validateMintAddress } from "./address";

/**
 * Address validation is a trust boundary: it runs in the browser for instant
 * feedback and again on the server, where it is the first thing standing
 * between untrusted input and an RPC call.
 */

describe("decodeBase58", () => {
  it("decodes a known 32-byte mint to 32 bytes", () => {
    const decoded = decodeBase58("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(decoded).not.toBeNull();
    expect(decoded!.length).toBe(32);
  });

  it("preserves leading zero bytes encoded as leading '1's", () => {
    // The System Program id is 32 zero bytes, written as 32 '1' characters.
    const decoded = decodeBase58("11111111111111111111111111111111");
    expect(decoded!.length).toBe(32);
    expect([...decoded!].every((byte) => byte === 0)).toBe(true);
  });

  it("rejects characters outside the base58 alphabet", () => {
    for (const ambiguous of ["0", "O", "I", "l"]) {
      expect(decodeBase58(`abc${ambiguous}def`)).toBeNull();
    }
    expect(decodeBase58("hello world")).toBeNull();
    expect(decodeBase58("")).toBeNull();
  });
});

describe("validateMintAddress", () => {
  const VALID = [
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "So11111111111111111111111111111111111111112",
    "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
  ];

  it("accepts real mainnet mint addresses", () => {
    for (const address of VALID) {
      expect(validateMintAddress(address)).toEqual({ valid: true, address });
    }
  });

  it("trims surrounding whitespace from a pasted address", () => {
    const result = validateMintAddress("  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \n");
    expect(result).toEqual({
      valid: true,
      address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    });
  });

  it("rejects malformed input with a reason the user can act on", () => {
    const cases = ["", "   ", "abc", "not-an-address", "0".repeat(44), "1".repeat(64)];
    for (const input of cases) {
      const result = validateMintAddress(input);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it("rejects base58 that decodes to the wrong byte length", () => {
    // Valid base58 characters, but far fewer than 32 bytes of payload.
    const result = validateMintAddress("1".repeat(33));
    expect(result.valid).toBe(false);
  });
});

describe("shortenAddress", () => {
  it("elides the middle of a long address", () => {
    expect(shortenAddress("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe("EPjF…Dt1v");
  });

  it("leaves short strings untouched", () => {
    expect(shortenAddress("abc")).toBe("abc");
  });
});
