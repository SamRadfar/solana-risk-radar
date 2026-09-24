import { describe, expect, it } from "vitest";

import {
  hasSeenTour,
  readTourRecord,
  tourStorageKey,
  writeTourRecord,
  type StorageLike,
} from "./tourStorage";

function fakeStorage(seed: Record<string, string> = {}): StorageLike & {
  data: Record<string, string>;
} {
  const data = { ...seed };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

/** Storage that exists but refuses every operation, as in private mode. */
const hostileStorage: StorageLike = {
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("QuotaExceededError");
  },
  removeItem() {
    throw new Error("SecurityError");
  },
};

const KEY = tourStorageKey("v1");

describe("tour persistence", () => {
  it("namespaces each tour under its own versioned key", () => {
    expect(tourStorageKey("v1")).toBe("solanaRiskRadar.onboarding.v1");
    expect(tourStorageKey("liquidity-v1")).toBe(
      "solanaRiskRadar.onboarding.liquidity-v1",
    );
  });

  it("treats a first-time visitor as not having seen the tour", () => {
    expect(hasSeenTour(fakeStorage(), "v1")).toBe(false);
  });

  it("records completion and reports the tour as seen", () => {
    const storage = fakeStorage();
    expect(writeTourRecord(storage, "v1", "completed")).toBe(true);
    expect(readTourRecord(storage, "v1")?.outcome).toBe("completed");
    expect(hasSeenTour(storage, "v1")).toBe(true);
  });

  it("records a skip and reports the tour as seen", () => {
    const storage = fakeStorage();
    writeTourRecord(storage, "v1", "skipped");
    expect(readTourRecord(storage, "v1")?.outcome).toBe("skipped");
    expect(hasSeenTour(storage, "v1")).toBe(true);
  });

  it("stamps the record with a time", () => {
    const storage = fakeStorage();
    writeTourRecord(storage, "v1", "completed");
    expect(readTourRecord(storage, "v1")?.at).not.toBe("");
  });

  it("keeps tours independent, so a new one can run for existing users", () => {
    const storage = fakeStorage();
    writeTourRecord(storage, "v1", "completed");
    expect(hasSeenTour(storage, "v1")).toBe(true);
    expect(hasSeenTour(storage, "v2")).toBe(false);
    expect(hasSeenTour(storage, "liquidity-v1")).toBe(false);
  });

  /* -------------------------------- failing safely -------------------------- */

  it("treats corrupt JSON as never seen rather than throwing", () => {
    const storage = fakeStorage({ [KEY]: "{not json" });
    expect(() => hasSeenTour(storage, "v1")).not.toThrow();
    expect(hasSeenTour(storage, "v1")).toBe(false);
  });

  it("rejects a record whose outcome is not one we wrote", () => {
    expect(hasSeenTour(fakeStorage({ [KEY]: '{"outcome":"maybe"}' }), "v1")).toBe(false);
    expect(hasSeenTour(fakeStorage({ [KEY]: '"completed"' }), "v1")).toBe(false);
    expect(hasSeenTour(fakeStorage({ [KEY]: "null" }), "v1")).toBe(false);
    expect(hasSeenTour(fakeStorage({ [KEY]: "[]" }), "v1")).toBe(false);
  });

  it("accepts a record missing its timestamp", () => {
    const storage = fakeStorage({ [KEY]: '{"outcome":"skipped"}' });
    expect(readTourRecord(storage, "v1")).toEqual({ outcome: "skipped", at: "" });
  });

  it("survives storage being unavailable entirely", () => {
    expect(hasSeenTour(null, "v1")).toBe(false);
    expect(readTourRecord(null, "v1")).toBeNull();
    expect(writeTourRecord(null, "v1", "completed")).toBe(false);
  });

  it("survives storage that throws on every access", () => {
    expect(() => hasSeenTour(hostileStorage, "v1")).not.toThrow();
    expect(hasSeenTour(hostileStorage, "v1")).toBe(false);
    expect(writeTourRecord(hostileStorage, "v1", "completed")).toBe(false);
  });
});
