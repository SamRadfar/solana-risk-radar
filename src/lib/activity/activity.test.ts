import { describe, expect, it, vi } from "vitest";
import { acquireActivity } from "./acquire";
import { normalizeActivity, rawAmount } from "./normalize";
import { measureActivity } from "./measure";
import { MemoryActivityStore } from "./store";
import { PublicKey } from "@solana/web3.js";
import { ACTIVITY_VERSION, BUDGET_MS, MAX_PARSED_RECORDS, MAX_POOLS, MAX_REQUESTS, MAX_TOTAL_BYTES, PARSE_BATCH_MAX, PARSE_BATCH_MIN, PARSE_MIN_INTERVAL_MS, RETENTION_MS } from "./policy";
import { MINT, NOW, POOLS, encodeBase58, mockProvider, transaction } from "./test-fixtures";
import liveShapes from "./fixtures/live-sol-transfers.json";
import { buildRiskReport, RULES } from "../risk-engine/engine";
import { makeInput } from "../risk-engine/test-fixtures";
import type { TokenOverview } from "../risk-engine/types";
import { MARKET_ALGORITHM_VERSION } from "../market/policy";

type Row = ReturnType<typeof transaction>;
const rows = (n: number, options: Parameters<typeof transaction>[1] = {}) => Array.from({ length: n }, (_, i) => transaction(i, options));
async function sample(input: Row[], options: Parameters<typeof mockProvider>[1] = {}) {
  const mock = mockProvider(input, options);
  return { ...(await acquireActivity(MINT, { apiKey: "synthetic-key", fetcher: mock.fetcher, now: () => NOW, parseIntervalMs: 0 })), calls: mock.calls };
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
    expect(Object.values(result.metrics!).every(m => m.status === "MEASURED")).toBe(true);
    expect(result.features?.concentration?.trade.top5).toEqual({ numerator: "5", denominator: "20", share: .25, resolvedCoverage: 1, recordCount: 20, walletsIncluded: 5 });
    expect(result.features?.concentration?.volume.top1.share).toBe(.05);
    expect(result.observedWindow?.lengthMs).toBe(19000);
    expect(result.requestedWindowMs).toBe(3600000);
    expect(calls).toHaveLength(4);
    expect(calls[2].body).toMatchObject({ method: "getTransactionsForAddress", params: [POOLS[0].address, { transactionDetails: "signatures", commitment: "finalized",
      filters: { status: "succeeded", blockTime: { gte: NOW / 1000 - 3600, lte: NOW / 1000 } } }] });
    expect(calls[3].body).toMatchObject({ includeRawTransaction: true, commitment: "finalized" });
    expect(calls[3].body.transactions as string[]).toHaveLength(20);
  });
  it.each(["highly active market maker", "legitimate arbitrage-like cycling"])("%s remains neutral evidence", async () => {
    const { result } = await sample(rows(20, { wallet: "active-controller" }));
    expect(result.features?.cycling?.cycleCount).toBe(19);
    expect(result.features?.cycling?.roundTripCount).toBe(10);
    expect(result.features?.inventory?.[0]).toMatchObject({ grossTradedRaw: "20000", netSwapFlowRaw: "0", actualInventoryChangeRaw: null });
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
    expect(result.features?.concentration?.volume.top1.numerator).toBe("9007199254740993000");
    expect(result.features?.concentration?.volume.top1.denominator).toBe("180143985094819860000");
  });
  it("same-wallet sequences expose both directions, gaps, and non-overlapping equal-size pairs", () => {
    const measured = measureActivity(rows(4, { wallet: "cycler" }).map(trade));
    expect(measured.cycling).toMatchObject({ walletsWithCycles: 1, cycleCount: 3, buySellTransitions: 2, sellBuyTransitions: 1, roundTripCount: 2, holdingIntervalsSeconds: [1, 1, 1] });
    expect(measured.cadence).toMatchObject({ intervalCount: 3, medianSeconds: 1, sameSlotActions: 0 });
  });
  it("heavy concentration exposes numerator and denominator", async () => {
    const { result } = await sample([...rows(18, { wallet: "concentrated" }), transaction(18), transaction(19)]);
    expect(result.features?.concentration?.trade.top1).toMatchObject({ numerator: "18", denominator: "20", share: .9, recordCount: 20 });
  });
  it("incomplete parser coverage returns insufficient data with failures retained", async () => {
    const { result, raw } = await sample([...rows(20), ...Array.from({ length: 10 }, (_, i) => transaction(i + 20, { parserError: true }))]);
    expect(result.status).toBe("INSUFFICIENT_DATA");
    expect(result.failedParses).toBe(10);
    expect(result.parserCoverage).toBeCloseTo(2 / 3);
    expect(Object.keys(raw)).toHaveLength(30);
  });
  it("no resolved traders withholds trader-dependent metrics but keeps trader-independent ones, without using fee payer", async () => {
    const { result } = await sample(rows(20, { unresolved: true }));
    expect(result.status).toBe("PARTIAL");
    expect(result.unresolvedTraderCount).toBe(20);
    expect(result.traderResolutionCoverage).toBe(0);
    expect(result.evidence.every(e => e.traderAddress === null && e.traderResolutionStatus === "UNRESOLVED")).toBe(true);
    for (const name of ["participants", "concentration", "cycling", "inventory"] as const) {
      expect(result.metrics?.[name]).toMatchObject({ status: "INSUFFICIENT_DATA", basis: "resolved-trader-subset", sampleSize: 0, actionCoverage: 0 });
    }
    expect(result.features).toMatchObject({ uniqueBuyers: null, uniqueSellers: null, concentration: null, cycling: null, inventory: null });
    expect(result.metrics?.repeatedSizes.status).toBe("MEASURED");
    expect(result.metrics?.cadence).toMatchObject({ status: "MEASURED", basis: "all-normalized-actions", sampleSize: 20, actionCoverage: 1 });
    expect(result.features?.cadence?.intervalCount).toBe(19);
  });
  it("routed low-resolution sample: a sufficient resolved subset is PARTIAL with disclosed coverage, not blocked by an 80% gate", async () => {
    const input = [...rows(25), ...Array.from({ length: 75 }, (_, i) => transaction(i + 25, { unresolved: true }))];
    const { result } = await sample(input);
    expect(result.traderResolutionCoverage).toBe(.25);
    expect(result.status).toBe("PARTIAL");
    expect(result.metrics?.concentration).toMatchObject({ status: "PARTIAL", sampleSize: 25, requiredSampleSize: 20, actionCoverage: .25, volumeCoverage: .25 });
    expect(result.metrics?.concentration.reasons.join(" ")).toContain("resolved subset only: 25/100 actions (25.0%)");
    expect(result.features?.concentration?.trade.top1).toMatchObject({ denominator: "25", resolvedCoverage: .25 });
    expect(result.features?.uniqueBuyers).toBe(13);
    expect(result.metrics?.cadence).toMatchObject({ status: "MEASURED", sampleSize: 100 });
  });
  it("a resolved subset below the sample gate stays INSUFFICIENT even when overall actions are plentiful", async () => {
    const input = [...rows(19), ...Array.from({ length: 81 }, (_, i) => transaction(i + 19, { unresolved: true }))];
    const { result } = await sample(input);
    expect(result.metrics?.participants).toMatchObject({ status: "INSUFFICIENT_DATA", sampleSize: 19 });
    expect(result.metrics?.participants.reasons).toContain("19 resolved-trader actions; 20 required in the resolved subset");
    expect(result.features?.concentration).toBeNull();
    expect(result.metrics?.repeatedSizes.status).toBe("MEASURED");
  });
  it("listing truncation applies a common frontier, parse budget bounds records, and the span is not claimed as a full hour", async () => {
    const { result, calls } = await sample(rows(1100));
    expect(result.status).toBe("PARTIAL");
    expect(result.signaturesListed).toBe(1000);
    expect(result.recordsReceived).toBe(MAX_PARSED_RECORDS);
    expect(result.signaturesNotFetched).toBe(500);
    expect(result.truncated).toBe(true);
    expect(result.observedWindow?.lengthMs).toBe(499000);
    expect(result.poolWindows[0].reachedWindowStart).toBe(false);
    expect(calls).toHaveLength(3 + MAX_PARSED_RECORDS / PARSE_BATCH_MAX);
    expect(result.stoppingReasons.join(" ")).toContain("common complete-listing frontier");
    expect(Object.values(result.metrics!).every(m => m.status === "PARTIAL")).toBe(true);
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
  it("duplicate listing is counted once and fetched once", async () => {
    const input = rows(20), { result, calls } = await sample([...input, ...input]);
    expect(result.duplicateRecords).toBe(20);
    expect(result.recordsReceived).toBe(20);
    expect(result.recordsExamined).toBe(20);
    expect(result.economicActions).toBe(20);
    expect(calls.filter(c => c.url.includes("parsed-events/transactions")).flatMap(c => c.body.transactions as string[])).toHaveLength(20);
  });
  it("failed transactions are filtered server-side and never consume parse, byte or record capacity", async () => {
    const failed = Array.from({ length: 30 }, (_, i) => transaction(i + 20, { failed: true }));
    const { result, calls } = await sample([...rows(20), ...failed]);
    const requested = calls.filter(c => c.url.includes("parsed-events/transactions")).flatMap(c => c.body.transactions as string[]);
    expect(requested).toHaveLength(20);
    expect(requested.some(signature => failed.some(f => f.signature === signature))).toBe(false);
    expect(result.failedTransactionFilter).toBe("server-side-succeeded-only");
    expect(result.failedTransactions).toBe(0);
    expect(result.recordsReceived).toBe(20);
    expect(result.status).toBe("MEASURED");
  });
  it("a provider that ignores the status filter still never has failed transactions fetched", async () => {
    const failed = transaction(21, { failed: true });
    const { result, calls, raw } = await sample([...rows(20), failed], { ignoreStatusFilter: true });
    expect(result.failedTransactions).toBe(1);
    expect(result.economicActions).toBe(20);
    expect(result.evidence.every(e => e.success)).toBe(true);
    expect(raw[failed.signature]).toBeUndefined();
    expect(calls.filter(c => c.url.includes("parsed-events/transactions")).flatMap(c => c.body.transactions as string[])).not.toContain(failed.signature);
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
  it("live Helius ATA-creation root (get_account_data_size CPI) is setup, not an unallocated transfer", () => {
    // Shape observed in live Parsed Events payloads: a separate CreateIdempotent root whose
    // Token-program CPIs are get_account_data_size / initialize_immutable_owner / initialize_account_3.
    const withAtaRoot = (innerName: string) => {
      const row = transaction(1);
      const keys = row.rawTransaction.transaction.message.accountKeys as string[];
      const ata = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", token = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
      keys.push(ata, token);
      const setup = { instructionIndex: 1, innerInstructionIndex: null as number | null, programId: ata, rawAccounts: [keys[1], "base-account"], rawData: "2", instructionName: "create_idempotent", summary: {} as never, decoded: { accounts: [] as { name: string; pubkey: string }[] } };
      const inner = ["get_account_data_size", "initialize_immutable_owner", innerName].map((name, i) => ({ ...setup, innerInstructionIndex: i, programId: token, rawAccounts: ["base-account"], rawData: String(i + 3), instructionName: name }));
      row.parsed.instructions.push(setup, ...inner);
      const compiled = (ix: typeof setup) => ({ programIdIndex: keys.indexOf(ix.programId), accounts: ix.rawAccounts.map(k => keys.indexOf(k)), data: ix.rawData });
      row.rawTransaction.transaction.message.instructions.push(compiled(setup));
      (row.rawTransaction.meta.innerInstructions as unknown[]).push({ index: 1, instructions: inner.map(compiled) });
      return row;
    };
    expect(normalizeActivity(withAtaRoot("initialize_account_3"), MINT, POOLS, "s")).toMatchObject({ kind: "trade", trade: { traderResolutionStatus: "RESOLVED", side: "SELL" } });
    expect(normalizeActivity(withAtaRoot("transfer"), MINT, POOLS, "s")).toMatchObject({ kind: "unparsed", reason: "Multiple economic roots or unallocated transfers" });
  });
  it("same-slot ordering is ambiguous and cannot create round trips", () => {
    const result = measureActivity(rows(4, { wallet: "cycler", sameSlot: 123 }).map(trade));
    expect(result.cycling.roundTripCount).toBe(0);
    expect(result.cycling.cycleCount).toBe(0);
    expect(result.cycling.ambiguousSameSlotPairs).toBe(3);
    expect(result.cadence.medianSeconds).toBeNull();
  });
  it("keeps partial metrics when a provider fails after usable evidence", async () => {
    const mock = mockProvider(rows(100));
    const fetcher: typeof fetch = (input, init) => mock.calls.length >= 4 ? Promise.resolve(new Response("limited", { status: 429 })) : mock.fetcher(input, init);
    const { result } = await acquireActivity(MINT, { apiKey: "fixture", fetcher, now: () => NOW });
    expect(result.status).toBe("PARTIAL");
    expect(result.economicActions).toBe(PARSE_BATCH_MAX);
    expect(result.errors[0]).toContain("429");
    expect(result.truncated).toBe(true);
    expect(Object.values(result.metrics!).every(m => m.status === "PARTIAL")).toBe(true);
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
  it("paces parse requests (no retry) to respect the provider's per-second limit by default", async () => {
    const mock = mockProvider(rows(120)), stamps: number[] = [];
    const fetcher: typeof fetch = (input, init) => { if (String(input).includes("parsed-events/transactions")) stamps.push(Date.now()); return mock.fetcher(input, init); };
    const { result } = await acquireActivity(MINT, { apiKey: "fixture", fetcher, now: () => NOW });
    expect(stamps).toHaveLength(3);
    expect(stamps[1] - stamps[0]).toBeGreaterThanOrEqual(PARSE_MIN_INTERVAL_MS - 5);
    expect(stamps[2] - stamps[1]).toBeGreaterThanOrEqual(PARSE_MIN_INTERVAL_MS - 5);
    expect(result.economicActions).toBe(120);
  });
  it("request plan is hard-bounded: discovery, owner check, one listing per pool and bounded parse batches", () => {
    expect(2 + MAX_POOLS + Math.ceil(MAX_PARSED_RECORDS / PARSE_BATCH_MAX)).toBeLessThanOrEqual(MAX_REQUESTS);
  });
  it("sizes parse batches from the live record-size ceiling so the byte budget stops cleanly instead of overrunning", async () => {
    const padded = rows(400).map(row => ({ ...row, padding: "x".repeat(100 * 1024) }));
    const { result, calls } = await sample(padded);
    expect(result.errors).toEqual([]);
    expect(result.bytesReceived).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
    expect(result.recordsReceived).toBeLessThan(400);
    expect(result.stoppingReasons.join(" ")).toContain("Response-byte planning budget reached");
    expect(calls.filter(c => c.url.includes("parsed-events/transactions")).every(c => (c.body.transactions as string[]).length >= PARSE_BATCH_MIN)).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.status).toBe("PARTIAL");
  });
  it("enforces the response byte limit", async () => {
    const fetcher: typeof fetch = async () => Response.json({ oversized: "x".repeat(7 * 1024 * 1024) });
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
    expect(ACTIVITY_VERSION).toBe("activity-intelligence-v0.2");
    expect(MARKET_ALGORITHM_VERSION).toBe("market-integrity-v2.5");
  });
});

describe("SOL transfers outside the swap root", () => {
  const SYSTEM = "11111111111111111111111111111111", TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const key = (seed: number) => new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => (seed * 31 + i * 7) % 251 + 1)).toBase58();
  const owner = key(1), stranger = key(2);
  const wsolAta = (wallet: string) => PublicKey.findProgramAddressSync([new PublicKey(wallet).toBuffer(), new PublicKey(TOKEN).toBuffer(), new PublicKey(MINT).toBuffer()],
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"))[0].toBase58();
  /** Synthetic swap whose requested-token (WSOL) account is the owner's real derived ATA. */
  const base = () => JSON.parse(JSON.stringify(transaction(1)).replaceAll("wallet-1", owner).replaceAll("base-account", wsolAta(owner))) as Row;
  function addRoot(row: Row, programId: string, accounts: string[], data: Uint8Array, name: string) {
    const keys = row.rawTransaction.transaction.message.accountKeys as string[];
    for (const k of [programId, ...accounts]) if (!keys.includes(k)) keys.push(k);
    const index = row.rawTransaction.transaction.message.instructions.length, rawData = encodeBase58(data);
    row.parsed.instructions.push({ ...row.parsed.instructions[0], instructionIndex: index, innerInstructionIndex: null, programId, rawAccounts: accounts, rawData, instructionName: name,
      summary: null as never, decoded: { accounts: [] } });
    row.rawTransaction.transaction.message.instructions.push({ programIdIndex: keys.indexOf(programId), accounts: accounts.map(a => keys.indexOf(a)), data: rawData });
    return row;
  }
  const transfer = (row: Row, from: string, to: string, lamports: bigint, discriminator = 2, name = "transfer") => {
    const data = Buffer.alloc(12); data.writeUInt32LE(discriminator, 0); data.writeBigUInt64LE(lamports, 4);
    return addRoot(row, SYSTEM, [from, to], data, name);
  };
  const syncNative = (row: Row, account: string) => addRoot(row, TOKEN, [account], Uint8Array.of(17), "sync_native");
  const normalize = (row: Row) => normalizeActivity(row, MINT, POOLS, "s");
  const JITO = "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5";

  it("baseline synthetic swap with real keys resolves", () => {
    expect(normalize(base())).toMatchObject({ kind: "trade", trade: { traderResolutionStatus: "RESOLVED", traderAddress: owner, ancillarySolTransfers: [] } });
  });
  it("documented Jito tip from the signer is recorded and does not affect resolution", () => {
    expect(normalize(transfer(base(), owner, JITO, BigInt(10_000)))).toMatchObject({ kind: "trade", trade: { traderResolutionStatus: "RESOLVED",
      ancillarySolTransfers: [{ kind: "tip", lamports: "10000", recipient: JITO, service: "Jito" }] } });
  });
  it("arbitrary SOL transfers are never allowed: unknown recipient, non-signer source, tip account with a trade role, other System transfer kinds", () => {
    const unallocated = { kind: "unparsed", reason: "Unallocated SOL transfer (not zero-value, a verified self-wrap or a documented tip account)" };
    expect(normalize(transfer(base(), owner, stranger, BigInt(10_000)))).toMatchObject(unallocated);
    expect(normalize(transfer(base(), "quote-account", JITO, BigInt(10_000)))).toMatchObject(unallocated);
    const tipAsTradeAccount = transfer(base(), owner, JITO, BigInt(10_000));
    tipAsTradeAccount.rawTransaction.meta.postTokenBalances.push({ ...tipAsTradeAccount.rawTransaction.meta.postTokenBalances[1], owner: JITO });
    expect(normalize(tipAsTradeAccount)).toMatchObject({ kind: "unparsed" });
    expect(normalize(transfer(base(), owner, JITO, BigInt(10_000), 11, "transfer_with_seed"))).toMatchObject(unallocated);
  });
  it("a name label cannot turn an unallocated transfer into a neutral System instruction", () => {
    expect(normalize(transfer(base(), owner, stranger, BigInt(10_000), 2, "advance_nonce_account"))).toMatchObject({ kind: "unparsed" });
  });
  it("zero-value transfers (e.g. jitodontfront markers) are value-free", () => {
    expect(normalize(transfer(base(), owner, stranger, BigInt(0)))).toMatchObject({ kind: "trade", trade: { traderResolutionStatus: "RESOLVED",
      ancillarySolTransfers: [{ kind: "zero-value", lamports: "0" }] } });
  });
  it("self-wrap requires the signer's own derived WSOL ATA and a later sync_native", () => {
    const ata = wsolAta(owner), other = wsolAta(stranger);
    expect(normalize(transfer(base(), owner, ata, BigInt(5_000)))).toMatchObject({ kind: "unparsed" });
    expect(normalize(syncNative(transfer(base(), owner, other, BigInt(5_000)), other))).toMatchObject({ kind: "unparsed" });
    const syncFirst = transfer(syncNative(base(), ata), owner, ata, BigInt(5_000));
    expect(normalize(syncFirst)).toMatchObject({ kind: "unparsed" });
  });
  it("a self-wrap into a persisting WSOL account contaminates that balance delta, so the owner is not RESOLVED", () => {
    const ata = wsolAta(owner), outcome = normalize(syncNative(transfer(base(), owner, ata, BigInt(5_000)), ata));
    expect(outcome).toMatchObject({ kind: "trade", trade: { ancillarySolTransfers: [{ kind: "self-wrap", lamports: "5000", recipient: ata }] } });
    expect(outcome.kind === "trade" && outcome.trade.traderResolutionStatus).not.toBe("RESOLVED");
  });

  // Captured live Helius Parsed Events envelopes (2026-09-27), minimized to normalizer-relevant fields.
  const live = liveShapes as unknown as Record<string, { mint: string; pools: typeof POOLS; row: Row }>;
  const normalizeLive = (name: string, mutate?: (row: Row) => void) => {
    const shape = live[name], row = JSON.parse(JSON.stringify(shape.row)) as Row;
    mutate?.(row);
    return normalizeActivity(row, shape.mint, shape.pools, "live");
  };
  it("live: Orca swap with a Helius Sender tip root resolves", () => {
    expect(normalizeLive("heliusSenderTipSwap")).toMatchObject({ kind: "trade", trade: { traderResolutionStatus: "RESOLVED", side: "BUY",
      ancillarySolTransfers: [{ kind: "tip", service: "Helius Sender", lamports: "5133" }] } });
  });
  it("live: Orca swap with a Jito tip root resolves", () => {
    expect(normalizeLive("jitoTipSwap")).toMatchObject({ kind: "trade", trade: { traderResolutionStatus: "RESOLVED", side: "BUY",
      ancillarySolTransfers: [{ kind: "tip", service: "Jito" }] } });
  });
  it("live: create ATA + self-wrap + sync_native + routed swap + close is a trade with the wrap disclosed", () => {
    expect(normalizeLive("selfWrapSwap")).toMatchObject({ kind: "trade", trade: { side: "BUY", ancillarySolTransfers: [{ kind: "self-wrap", lamports: "820000000" }] } });
  });
  it("live: an unrecognized fee recipient is the only SOL-transfer blocker in a zero-marker + self-wrap + fee route", () => {
    expect(normalizeLive("unrecognizedSolRecipient")).toMatchObject({ kind: "unparsed", reason: "Unallocated SOL transfer (not zero-value, a verified self-wrap or a documented tip account)" });
    const fee = "9TFHAowAEo1Xf2qD9KBBEzNuoaYNGjD2AhV8iYEdrkpc", replace = (row: Row) => {
      const keys = row.rawTransaction.transaction.message.accountKeys as string[];
      keys[keys.indexOf(fee)] = JITO;
      for (const ix of row.parsed.instructions) ix.rawAccounts = ix.rawAccounts.map((a: string) => a === fee ? JITO : a);
    };
    // With the fee recipient replaced, the zero-value marker and verified self-wrap pass; the route then
    // fails on its own merits (JUP is an intermediate hop in SOL -> JUP -> CWZ6), not on SOL transfers.
    expect(normalizeLive("unrecognizedSolRecipient", replace)).toMatchObject({ kind: "unparsed", reason: "Economic amount cannot be reconstructed (including zero-net atomic routes)" });
  });
});
