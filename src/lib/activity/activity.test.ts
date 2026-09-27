import { describe, expect, it, vi } from "vitest";
import { acquireActivity } from "./acquire";
import { normalizeActivity, rawAmount } from "./normalize";
import { measureActivity } from "./measure";
import { MemoryActivityStore } from "./store";
import { ACTIVITY_VERSION, BUDGET_MS, RETENTION_MS } from "./policy";
import { MINT, NOW, POOLS, mockProvider, transaction } from "./test-fixtures";
import { buildRiskReport, RULES } from "../risk-engine/engine";
import { makeInput } from "../risk-engine/test-fixtures";
import type { TokenOverview } from "../risk-engine/types";
import { MARKET_ALGORITHM_VERSION } from "../market/policy";

type Row = ReturnType<typeof transaction>;
const rows = (n: number, options: Parameters<typeof transaction>[1] = {}) => Array.from({ length: n }, (_, i) => transaction(i, options));
async function sample(input: Row[], options: Parameters<typeof mockProvider>[1] = {}) {
  const mock = mockProvider(input, options);
  return { ...(await acquireActivity(MINT, { apiKey: "synthetic-key", fetcher: mock.fetcher, now: () => NOW })), calls: mock.calls };
}
function trade(row: Row) {
  const normalized = normalizeActivity(row, MINT, POOLS, "snapshot");
  if (normalized.kind !== "trade") throw new Error(normalized.reason);
  return normalized.trade;
}

describe("activity evidence: behavior is measured without behavioral labels", () => {
  it("ordinary distributed trading has exact sample concentration and distinct buyers/sellers", async () => {
    const { result, calls } = await sample(rows(20));
    expect(result.status).toBe("MEASURED");
    expect(result.features?.uniqueBuyers).toBe(10);
    expect(result.features?.uniqueSellers).toBe(10);
    expect(result.features?.concentration.trade.top5).toEqual({ numerator: "5", denominator: "20", share: .25, resolvedCoverage: 1, recordCount: 20, walletsIncluded: 5 });
    expect(result.features?.concentration.volume.top1.share).toBe(.05);
    expect(result.observedWindow?.lengthMs).toBe(19000);
    expect(result.requestedWindowMs).toBe(3600000);
    expect(calls).toHaveLength(3);
    expect(calls[2].body).toMatchObject({ includeRawTransaction: true, commitment: "finalized", limit: 100, time: { gte: NOW / 1000 - 3600, lte: NOW / 1000 } });
  });
  it.each(["highly active market maker", "legitimate arbitrage-like cycling"])("%s remains neutral evidence", async () => {
    const { result } = await sample(rows(20, { wallet: "active-controller" }));
    expect(result.features?.cycling.cycleCount).toBe(19);
    expect(result.features?.cycling.roundTripCount).toBe(10);
    expect(result.features?.inventory[0]).toMatchObject({ grossTradedRaw: "20000", netSwapFlowRaw: "0", actualInventoryChangeRaw: null });
    expect(JSON.stringify(result.features)).not.toMatch(/scam|wash trading|insider|malicious|\bbot\b/i);
    expect(result).not.toHaveProperty("riskScore");
    expect(result).not.toHaveProperty("classification");
  });
  it("aggregator CPI legs normalize to one action using actual controller, not fee payer", () => {
    const action = trade(transaction(1, { routed: true, wallet: "actual-controller" }));
    expect(action.pools).toHaveLength(2);
    expect(action.traderAddress).toBe("actual-controller");
    expect(action.baseAmountRaw).toBe("1000");
    expect(action.economicActionId).toBe("signature-1:0");
    expect(action.quoteAmountRaw).toBe("500");
    expect(action.rawEvidenceReference).toBe("snapshot:signature-1");
  });
  it("repeated sizes use exact integer units and side without manipulation inference", async () => {
    const { result } = await sample(rows(20, { amount: "9007199254740993000" }));
    expect(result.features?.repeatedSizes).toMatchObject({ repeatedGroups: 2, recordsInRepeatedGroups: 20, eligibleRecords: 20 });
    expect(result.features?.concentration.volume.top1.numerator).toBe("9007199254740993000");
    expect(result.features?.concentration.volume.top1.denominator).toBe("180143985094819860000");
  });
  it("same-wallet sequences expose both directions, gaps, and non-overlapping equal-size pairs", () => {
    const measured = measureActivity(rows(4, { wallet: "cycler" }).map(trade));
    expect(measured.cycling).toMatchObject({ walletsWithCycles: 1, cycleCount: 3, buySellTransitions: 2, sellBuyTransitions: 1, roundTripCount: 2, holdingIntervalsSeconds: [1, 1, 1] });
    expect(measured.cadence).toMatchObject({ intervalCount: 3, medianSeconds: 1, sameSlotActions: 0 });
  });
  it("heavy concentration exposes numerator and denominator", async () => {
    const { result } = await sample([...rows(18, { wallet: "concentrated" }), transaction(18), transaction(19)]);
    expect(result.features?.concentration.trade.top1).toMatchObject({ numerator: "18", denominator: "20", share: .9, recordCount: 20 });
  });
  it("incomplete parser coverage returns insufficient data with failures retained", async () => {
    const { result, raw } = await sample([...rows(20), ...Array.from({ length: 10 }, (_, i) => transaction(i + 20, { parserError: true }))]);
    expect(result.status).toBe("INSUFFICIENT_DATA");
    expect(result.failedParses).toBe(10);
    expect(result.parserCoverage).toBeCloseTo(2 / 3);
    expect(Object.keys(raw)).toHaveLength(30);
  });
  it("high unresolved-owner share withholds interpretation and does not use fee payer", async () => {
    const { result } = await sample(rows(20, { unresolved: true }));
    expect(result.status).toBe("INSUFFICIENT_DATA");
    expect(result.unresolvedTraderCount).toBe(20);
    expect(result.traderResolutionCoverage).toBe(0);
    expect(result.evidence.every(e => e.traderAddress === null && e.traderResolutionStatus === "UNRESOLVED")).toBe(true);
    expect(result.features?.concentration.trade.top1.share).toBeNull();
    expect(result.features?.concentration.trade.top1.resolvedCoverage).toBe(0);
  });
  it("1000-record truncation reports actual span and does not claim a full hour", async () => {
    const { result, calls } = await sample(rows(1100));
    expect(result.status).toBe("PARTIAL");
    expect(result.recordsReceived).toBe(1000);
    expect(result.truncated).toBe(true);
    expect(result.observedWindow?.lengthMs).toBe(999000);
    expect(result.poolWindows[0].reachedWindowStart).toBe(false);
    expect(calls).toHaveLength(12);
  });
  it("missing Helius configuration returns precise unavailable without any request", async () => {
    const fetcher = vi.fn();
    const { result } = await acquireActivity(MINT, { fetcher, now: () => NOW });
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.errors[0]).toContain("HELIUS_API_KEY");
    expect(result.features).toBeNull();
    expect(result.parserCoverage).toBeNull();
    expect(result.requestCount).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("Helius 429 is acquisition unavailable, with no retry or market conflict", async () => {
    const { result, calls } = await sample(rows(20), { rateLimit: true });
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.errors[0]).toContain("HTTP 429");
    expect(result.features).toBeNull();
    expect(calls).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain("conflict");
  });
  it("duplicate retrieval is counted once", async () => {
    const input = rows(20), { result } = await sample([...input, ...input]);
    expect(result.recordsReceived).toBe(40);
    expect(result.recordsExamined).toBe(20);
    expect(result.duplicateRecords).toBe(20);
    expect(result.economicActions).toBe(20);
  });
  it("failed transactions never contribute activity and remain available as raw evidence", async () => {
    const { result, raw } = await sample([...rows(20), transaction(21, { failed: true })]);
    expect(result.failedTransactions).toBe(1);
    expect(result.economicActions).toBe(20);
    expect(result.evidence.every(e => e.success)).toBe(true);
    expect(raw["signature-21"]).toBeDefined();
  });
  it("multiple pools preserve scope and deduplicate shared routed transaction", async () => {
    const { result } = await sample(rows(20, { routed: true }), { pools: 2 });
    expect(result.poolsCovered).toHaveLength(2);
    expect(result.poolWindows.every(p => p.reachedWindowStart)).toBe(true);
    expect(result.economicActions).toBe(20);
    expect(result.duplicateRecords).toBe(20);
  });
});

describe("fail-closed boundaries and resource limits", () => {
  it("rejects unsafe numeric token amounts", () => {
    expect(rawAmount(9007199254740992)).toBeNull();
    expect(rawAmount("9007199254740992")).toBe(BigInt("9007199254740992"));
    const row = transaction(1);
    row.rawTransaction.meta.postTokenBalances[0].uiTokenAmount.amount = "invalid";
    expect(trade(row).traderResolutionStatus).toBe("UNRESOLVED");
  });
  it("does not reconstruct missing new/closed account balances as zero", () => {
    const row = transaction(1);
    row.rawTransaction.meta.preTokenBalances = [];
    expect(trade(row).traderResolutionStatus).toBe("UNRESOLVED");
  });
  it("raw transaction mismatch and omitted parser instructions fail closed", () => {
    const row = transaction(1);
    row.rawTransaction.slot++;
    expect(normalizeActivity(row, MINT, POOLS, "s").kind).toBe("unparsed");
    const omitted = transaction(2, { routed: true });
    omitted.parsed.instructions.pop();
    expect(normalizeActivity(omitted, MINT, POOLS, "s").kind).toBe("unparsed");
  });
  it("decoded pool or swap labels cannot override raw program/discriminator evidence", () => {
    const row = transaction(1);
    row.parsed.instructions[0].decoded.accounts[0].pubkey = "wrong-pool";
    expect(normalizeActivity(row, MINT, POOLS, "s").kind).toBe("unparsed");
    const forged = transaction(2);
    forged.parsed.instructions[0].rawData = "11111111";
    forged.rawTransaction.transaction.message.instructions[0].data = "11111111";
    expect(normalizeActivity(forged, MINT, POOLS, "s").kind).toBe("unparsed");
  });
  it("multiple independent swap roots are not one economic action", () => {
    const row = transaction(1);
    row.parsed.instructions.push({ ...row.parsed.instructions[0], instructionIndex: 1 });
    row.rawTransaction.transaction.message.instructions.push(row.rawTransaction.transaction.message.instructions[0]);
    expect(normalizeActivity(row, MINT, POOLS, "s")).toMatchObject({ kind: "unparsed", reason: "Multiple economic roots or unallocated transfers" });
  });
  it("same-slot ordering is ambiguous and cannot create round trips", () => {
    const result = measureActivity(rows(4, { wallet: "cycler", sameSlot: 123 }).map(trade));
    expect(result.cycling.roundTripCount).toBe(0);
    expect(result.cycling.cycleCount).toBe(0);
    expect(result.cycling.ambiguousSameSlotPairs).toBe(3);
    expect(result.cadence.medianSeconds).toBeNull();
  });
  it("keeps partial metrics when a provider fails after usable evidence", async () => {
    const mock = mockProvider(rows(100), { endless: true });
    const fetcher: typeof fetch = (input, init) => mock.calls.length >= 3 ? Promise.resolve(new Response("limited", { status: 429 })) : mock.fetcher(input, init);
    const { result } = await acquireActivity(MINT, { apiKey: "fixture", fetcher, now: () => NOW });
    expect(result.status).toBe("PARTIAL");
    expect(result.economicActions).toBe(100);
    expect(result.errors[0]).toContain("429");
    expect(result.truncated).toBe(true);
  });
  it("deadline aborts pending I/O and never retries", async () => {
    vi.useFakeTimers();
    try {
      const fetcher: typeof fetch = (_input, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
      const promise = acquireActivity(MINT, { apiKey: "fixture", fetcher });
      await vi.advanceTimersByTimeAsync(BUDGET_MS);
      const { result } = await promise;
      expect(result.elapsedMs).toBe(BUDGET_MS);
      expect(result.requestCount).toBe(1);
      expect(result.status).toBe("PARTIAL");
      expect(result.features).toBeNull();
      expect(result.errors[0]).toContain("Elapsed-time budget");
    } finally { vi.useRealTimers(); }
  });
  it("transport exceptions never disclose request URLs or API keys", async () => {
    const { result } = await sample([], { requestError: true });
    expect(JSON.stringify(result)).not.toContain("synthetic-key");
    expect(JSON.stringify(result)).not.toContain("secret-key");
    expect(result.errors).toEqual(["dexscreener transport or invalid JSON response"]);
  });
  it("request-count budget stops duplicate-heavy pagination", async () => {
    const mock = mockProvider(rows(20));
    let page = 0;
    const fetcher: typeof fetch = (input, init) => String(input).includes("transaction-history")
      ? Promise.resolve(Response.json({ data: rows(20), paginationToken: String(++page) })) : mock.fetcher(input, init);
    const { result } = await acquireActivity(MINT, { apiKey: "fixture", fetcher, now: () => NOW });
    expect(result.requestCount).toBe(15);
    expect(result.status).toBe("PARTIAL");
    expect(result.economicActions).toBe(20);
    expect(result.duplicateRecords).toBe(240);
    expect(result.stoppingReasons).toContain("Request-count budget exhausted");
  });
  it("enforces the response byte limit", async () => {
    const fetcher: typeof fetch = async () => Response.json({ oversized: "x".repeat(4 * 1024 * 1024) });
    const { result } = await acquireActivity(MINT, { apiKey: "fixture", fetcher, now: () => NOW });
    expect(result.truncated).toBe(true);
    expect(result.errors).toEqual(["Response-byte budget exhausted"]);
  });
  it("does not mix requested-token decimal units across records", async () => {
    const changed = transaction(20);
    for (const balances of [changed.rawTransaction.meta.preTokenBalances, changed.rawTransaction.meta.postTokenBalances]) balances[0].uiTokenAmount.decimals = 6;
    const { result } = await sample([...rows(20), changed]);
    expect(result.status).toBe("INSUFFICIENT_DATA");
    expect(result.features).toBeNull();
    expect(result.errors).toContain("Inconsistent token units across observations");
  });
  it("atomic same-asset routes are not falsely treated as directional buying", () => {
    const row = transaction(1, { routed: true });
    row.parsed.instructions[0].summary.parsedData.input_mint = MINT;
    row.parsed.instructions[0].summary.parsedData.output_mint = MINT;
    expect(normalizeActivity(row, MINT, POOLS, "s").kind).toBe("unparsed");
  });
  it("separate cache expires/evicts evidence honestly and freshness is shorter than retention", async () => {
    const snapshot = await sample(rows(20)), store = new MemoryActivityStore(1);
    store.put(snapshot);
    expect(store.latest(MINT, NOW + 59999)).not.toBeNull();
    expect(store.latest(MINT, NOW + 60000)).toBeNull();
    expect(store.snapshot(snapshot.result.snapshotId, NOW + 60000)).not.toBeNull();
    expect(store.snapshot(snapshot.result.snapshotId, NOW + RETENTION_MS)).toBeNull();
    store.put(snapshot);
    store.put({ result: { ...snapshot.result, snapshotId: "different" }, raw: {} });
    expect(store.snapshot(snapshot.result.snapshotId, NOW)).toBeNull();
  });
  it("does not alter 13-signal scoring, denominator, coverage, categories or market version", async () => {
    const input = makeInput(), context = { overview: {} as TokenOverview, sources: [], elapsedMs: 0 };
    const before = buildRiskReport(input, context);
    await sample(rows(20, { wallet: "concentrated" }));
    const after = buildRiskReport(input, context);
    expect({ ...after, generatedAt: before.generatedAt }).toEqual(before);
    expect(RULES).toHaveLength(13);
    expect(after.totalWeight).toBe(152);
    expect(ACTIVITY_VERSION).toBe("activity-intelligence-v0.1");
    expect(MARKET_ALGORITHM_VERSION).toBe("market-integrity-v2.5");
  });
});
