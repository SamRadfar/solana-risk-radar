import { ACTIVITY_VERSION, FRESH_MS } from "./policy";
import type { ActivitySnapshot } from "./types";

/** Replaceable storage boundary. No durability claim: eviction/restart is allowed. */
export interface ActivityStore {
  latest(mint: string, now: number): ActivitySnapshot | null;
  snapshot(id: string, now: number): ActivitySnapshot | null;
  put(snapshot: ActivitySnapshot): void;
}
export class MemoryActivityStore implements ActivityStore {
  private entries = new Map<string, ActivitySnapshot>();
  constructor(private readonly capacity = 4) {}
  snapshot(id: string, now: number): ActivitySnapshot | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (entry.result.expiresAt <= now) { this.entries.delete(id); return null; }
    return entry;
  }
  latest(mint: string, now: number): ActivitySnapshot | null {
    const entries = [...this.entries.values()].reverse();
    return entries.find(s => this.snapshot(s.result.snapshotId, now) && s.result.mint === mint &&
      s.result.version === ACTIVITY_VERSION && now - s.result.fetchedAt < FRESH_MS) ?? null;
  }
  put(snapshot: ActivitySnapshot): void {
    this.entries.delete(snapshot.result.snapshotId);
    while (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(snapshot.result.snapshotId, snapshot);
  }
}
export const activityStore: ActivityStore = new MemoryActivityStore();
