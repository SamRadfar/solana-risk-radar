/**
 * Versioned, fail-safe persistence for guided tours.
 *
 * Each tour owns its own key — `solanaRiskRadar.onboarding.<tourId>` — rather
 * than one shared "hasOnboarded" flag. A later feature tour can therefore be
 * shown to someone who already finished the main one without replaying it, and
 * bumping a tour's id is all that is needed to re-introduce it.
 *
 * Every access is wrapped: storage can be absent (SSR), disabled (private
 * mode, blocked cookies), full, or holding JSON written by an older version.
 * None of that may stop the application rendering, so every failure resolves
 * to "not seen" and the caller carries on.
 */

export type TourOutcome = "completed" | "skipped";

export interface TourRecord {
  outcome: TourOutcome;
  /** ISO timestamp; empty when an older record did not carry one. */
  at: string;
}

/** The subset of the Storage API this module needs — keeps tests trivial. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = "solanaRiskRadar.onboarding";

export function tourStorageKey(tourId: string): string {
  return `${PREFIX}.${tourId}`;
}

/**
 * Returns localStorage only if it is genuinely writable.
 *
 * Safari's private mode exposes the object and throws on write, so presence
 * alone is not enough — the probe is the only reliable test.
 */
export function resolveStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    const storage = window.localStorage;
    if (!storage) return null;
    const probe = `${PREFIX}.probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/** Reads a tour's record, treating anything unrecognisable as "never seen". */
export function readTourRecord(
  storage: StorageLike | null,
  tourId: string,
): TourRecord | null {
  if (!storage) return null;

  try {
    const raw = storage.getItem(tourStorageKey(tourId));
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;

    const { outcome, at } = parsed as { outcome?: unknown; at?: unknown };
    if (outcome !== "completed" && outcome !== "skipped") return null;

    return { outcome, at: typeof at === "string" ? at : "" };
  } catch {
    // Corrupt JSON, a hostile getItem, or a quota error on read.
    return null;
  }
}

/**
 * Records how a tour ended. Returns whether it was actually stored — the tour
 * still closes either way, so a false here only means it may reappear on the
 * next visit, which is far better than blocking the UI.
 */
export function writeTourRecord(
  storage: StorageLike | null,
  tourId: string,
  outcome: TourOutcome,
): boolean {
  if (!storage) return false;

  try {
    storage.setItem(
      tourStorageKey(tourId),
      JSON.stringify({ outcome, at: new Date().toISOString() }),
    );
    return true;
  } catch {
    return false;
  }
}

/** True when this tour version has already been completed or skipped. */
export function hasSeenTour(storage: StorageLike | null, tourId: string): boolean {
  return readTourRecord(storage, tourId) !== null;
}
