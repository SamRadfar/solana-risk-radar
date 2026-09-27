import { createHash } from "node:crypto";
import { normalizeActivity, object, list, text, integer } from "./normalize";
import { measureActivity } from "./measure";
import { ACTIVITY_VERSION, WINDOW_MS, MAX_RECORDS, MAX_POOLS, MAX_REQUESTS, BUDGET_MS, MAX_RESPONSE_BYTES, MAX_TOTAL_BYTES, MIN_ACTIONS, MIN_PARSER_COVERAGE, MIN_TRADER_COVERAGE, RETENTION_MS, SUPPORTED_PROGRAMS } from "./policy";
import type { ActivityEvidenceResult, ActivityPool, ActivitySnapshot } from "./types";

export interface AcquisitionOptions { apiKey?: string; fetcher?: typeof fetch; now?: () => number; signal?: AbortSignal }
/** Entire discovery + RPC + parsed-history budget is shared. No retries or fallback crawl. */
export async function acquireActivity(mint: string, options: AcquisitionOptions = {}): Promise<ActivitySnapshot> {
  const now = options.now ?? Date.now, started = now(), fetchedAt = started;
  const snapshotId = createHash("sha256").update(`${ACTIVITY_VERSION}:${mint}:${started}`).digest("hex").slice(0, 24);
  const result: ActivityEvidenceResult = {
    version: ACTIVITY_VERSION, observationOnly: true, mint, snapshotId, status: "UNAVAILABLE",
    requestedWindow: { from: started - WINDOW_MS, to: started }, requestedWindowMs: WINDOW_MS, observedWindow: null,
    fetchedAt, expiresAt: fetchedAt + RETENTION_MS, elapsedMs: 0, requestCount: 0, recordsReceived: 0, recordsExamined: 0, duplicateRecords: 0,
    economicActions: 0, successfulParses: 0, failedParses: 0, failedTransactions: 0, excludedRecords: 0,
    parserCoverage: null, resolvedTraderCount: 0, unresolvedTraderCount: 0, traderResolutionCoverage: null,
    poolsCovered: [], poolWindows: [], providersUsed: [], truncated: false, stoppingReasons: [], errors: [], exclusions: {}, features: null, evidence: [],
    limitations: [
      "Observation only; not included in score, coverage or categories.",
      "Selected supported pools only; token-wide venue completeness is unknown. Pool selection uses provider-reported liquidity, not proof of economic activity.",
      "Resolved addresses are signing account controllers, not independent people or beneficial owners.",
      "No USD volume: concentration uses requested-token integer units. Quote deltas are retained only when unambiguous.",
      "Gross and net swap flows exclude other transfers; actual inventory change and economic profit remain unmeasured.",
      "Multi-root transactions, zero-net atomic routes and incomplete token-balance histories are not reconstructed.",
      "Repetition and cycling can reflect preset order sizes, arbitrage and market making; they establish no intent.",
      "Raw evidence is retained in a bounded process-local cache for five minutes; restart or eviction can remove it earlier.",
      `Eligibility requires ${MIN_ACTIONS} actions, ${MIN_PARSER_COVERAGE * 100}% parser coverage and ${MIN_TRADER_COVERAGE * 100}% trader resolution. These are data-quality gates, not risk thresholds.`,
    ],
  };
  const raw: Record<string, unknown> = {};
  const finish = (): ActivitySnapshot => {
    result.elapsedMs = Math.max(0, now() - started);
    result.economicActions = result.evidence.length;
    result.resolvedTraderCount = result.evidence.filter(a => a.traderResolutionStatus === "RESOLVED").length;
    result.unresolvedTraderCount = result.economicActions - result.resolvedTraderCount;
    const attempts = result.successfulParses + result.failedParses;
    result.parserCoverage = attempts ? result.successfulParses / attempts : null;
    result.traderResolutionCoverage = result.economicActions ? result.resolvedTraderCount / result.economicActions : null;
    if (result.evidence.length) {
      const times = result.evidence.map(a => a.blockTime * 1000);
      result.observedWindow = { from: Math.min(...times), to: Math.max(...times), lengthMs: Math.max(...times) - Math.min(...times) };
      result.features = measureActivity(result.evidence);
      result.status = result.economicActions < MIN_ACTIONS || (result.parserCoverage ?? 0) < MIN_PARSER_COVERAGE || (result.traderResolutionCoverage ?? 0) < MIN_TRADER_COVERAGE
        ? "INSUFFICIENT_DATA" : result.truncated || result.errors.length || result.failedParses || result.unresolvedTraderCount || result.poolWindows.some(p => !p.reachedWindowStart) ? "PARTIAL" : "MEASURED";
    } else if (result.recordsExamined || result.poolWindows.some(p => p.reachedWindowStart)) result.status = "INSUFFICIENT_DATA";
    else if (result.truncated && result.stoppingReasons.some(reason => reason.includes("budget"))) result.status = "PARTIAL";
    return { result, raw };
  };
  if (!options.apiKey?.trim()) { result.errors.push("HELIUS_API_KEY is not configured; no activity acquisition was attempted."); return finish(); }
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, BUDGET_MS);
  let bytes = 0;
  const fetcher = options.fetcher ?? fetch;
  async function json(url: string, source: string, body?: unknown): Promise<unknown> {
    if (controller.signal.aborted || now() - started >= BUDGET_MS) throw new Error("Elapsed-time budget exhausted or request cancelled");
    if (result.requestCount >= MAX_REQUESTS) throw new Error("Request-count budget exhausted");
    result.requestCount++;
    if (!result.providersUsed.includes(source)) result.providersUsed.push(source);
    try {
      const response = await fetcher(url, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, signal: controller.signal, cache: "no-store" });
      if (controller.signal.aborted || now() - started >= BUDGET_MS) { await response.body?.cancel(); throw new Error("Elapsed-time budget exhausted or request cancelled"); }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`${source} HTTP ${response.status}${response.status === 429 ? " (rate limited; no retry in this snapshot)" : ""}`); }
      if (!response.body) throw new Error(`${source} empty response`);
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let size = 0, content = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength; bytes += value.byteLength;
          if (size > MAX_RESPONSE_BYTES || bytes > MAX_TOTAL_BYTES) throw new Error("Response-byte budget exhausted");
          content += decoder.decode(value, { stream: true });
        }
        content += decoder.decode();
        return JSON.parse(content);
      } finally { await reader.cancel().catch(() => undefined); }
    } catch (error) {
      // Transport errors can embed URLs/API keys. Only our own bounded reasons leave this module.
      const message = error instanceof Error ? error.message : "";
      if (/^(dexscreener|helius).*HTTP \d+|^(Response-byte|Request-count|Elapsed-time) budget/.test(message)) throw new Error(message);
      throw new Error(controller.signal.aborted ? "Elapsed-time budget exhausted or request cancelled" : `${source} transport or invalid JSON response`);
    }
  }
  try {
    const discovered = await json(`https://api.dexscreener.com/token-pairs/v1/solana/${encodeURIComponent(mint)}`, "dexscreener");
    if (!Array.isArray(discovered)) throw new Error("Pool discovery returned an invalid schema");
    const candidates = [...new Map(discovered.map(object).filter(p => p.chainId === "solana" && text(p.pairAddress) &&
      (object(p.baseToken).address === mint || object(p.quoteToken).address === mint) && object(p.baseToken).address !== object(p.quoteToken).address)
      .sort((a, b) => Number(object(b.liquidity).usd ?? 0) - Number(object(a.liquidity).usd ?? 0) || String(a.pairAddress).localeCompare(String(b.pairAddress)))
      .map(p => [String(p.pairAddress), p])).values()].slice(0, 20);
    if (!candidates.length) throw new Error("No identified pools returned for requested mint");
    const rpc = object(await json(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(options.apiKey)}`, "helius-rpc", {
      jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [candidates.map(p => p.pairAddress), { encoding: "base64", commitment: "finalized", dataSlice: { offset: 0, length: 0 } }],
    }));
    if (rpc.error || !Array.isArray(object(rpc.result).value)) throw new Error("Pool owner verification unavailable");
    const accounts = list(object(rpc.result).value);
    const pools: ActivityPool[] = candidates.flatMap((p, i) => {
      const owner = text(object(accounts[i]).owner), policy = owner ? SUPPORTED_PROGRAMS[owner] : null;
      const baseMint = text(object(p.baseToken).address), quoteMint = text(object(p.quoteToken).address);
      return owner && policy && baseMint && quoteMint && object(accounts[i]).executable === false ? [{ address: String(p.pairAddress), program: owner, venue: policy.venue, baseMint, quoteMint }] : [];
    }).slice(0, MAX_POOLS);
    if (!pools.length) throw new Error("No supported RPC-owner-verified pools (Raydium CPMM or Orca Whirlpool) in discovery sample");
    result.poolWindows = pools.map(p => ({ pool: p.address, reachedWindowStart: false, oldestRecordAt: null }));
    const cursors = new Map<string, string>(), completed = new Set<string>(), seenCursors = new Set<string>(), seen = new Set<string>();
    // Round-robin pages prevent one busy pool consuming every request first.
    while (completed.size < pools.length && result.recordsReceived < MAX_RECORDS) {
      for (const pool of pools) {
        if (completed.has(pool.address) || result.recordsReceived >= MAX_RECORDS) continue;
        const page = object(await json(`https://mainnet.helius-rpc.com/v1/parsed-events/transaction-history?api-key=${encodeURIComponent(options.apiKey)}`, "helius-parsed-events", {
          address: pool.address, limit: Math.min(100, MAX_RECORDS - result.recordsReceived), sortOrder: "desc", commitment: "finalized", includeRawTransaction: true,
          time: { gte: Math.floor(result.requestedWindow.from / 1000), lte: Math.floor(result.requestedWindow.to / 1000) },
          ...(cursors.has(pool.address) ? { paginationToken: cursors.get(pool.address) } : {}),
        }));
        if (!Array.isArray(page.data)) throw new Error("Helius history returned an invalid page schema");
        if (page.data.length > Math.min(100, MAX_RECORDS - result.recordsReceived)) throw new Error("Helius history exceeded requested page size");
        if (!result.poolsCovered.some(p => p.address === pool.address)) result.poolsCovered.push(pool);
        const window = result.poolWindows.find(p => p.pool === pool.address)!;
        const rows = page.data;
        for (const row of rows) {
          if (result.recordsReceived >= MAX_RECORDS) break;
          result.recordsReceived++;
          const signature = text(object(row).signature), time = integer(object(object(row).parsed).blockTime);
          if (time !== null) window.oldestRecordAt = Math.min(window.oldestRecordAt ?? Infinity, time * 1000);
          if (signature && seen.has(signature)) { result.duplicateRecords++; continue; }
          if (signature) { seen.add(signature); raw[signature] = row; }
          result.recordsExamined++;
          if (time !== null && (time * 1000 < result.requestedWindow.from || time * 1000 > result.requestedWindow.to)) {
            result.excludedRecords++; result.exclusions["Outside requested window"] = (result.exclusions["Outside requested window"] ?? 0) + 1; continue;
          }
          const normalized = normalizeActivity(row, mint, pools, snapshotId);
          if (normalized.kind === "trade") {
            if (result.evidence.length && result.evidence[0].baseDecimals !== normalized.trade.baseDecimals) {
              result.failedParses++; result.errors.push("Conflicting requested-token decimals; snapshot interpretation withheld");
              result.evidence = []; result.successfulParses = 0;
              throw new Error("Inconsistent token units across observations");
            }
            result.successfulParses++; result.evidence.push(normalized.trade);
          }
          else {
            if (normalized.kind === "unparsed") result.failedParses++;
            else if (normalized.kind === "failed") result.failedTransactions++;
            else result.excludedRecords++;
            result.exclusions[normalized.reason] = (result.exclusions[normalized.reason] ?? 0) + 1;
          }
        }
        const cursor = text(page.paginationToken);
        if (!cursor) { completed.add(pool.address); window.reachedWindowStart = true; }
        else {
          const key = pool.address + ":" + cursor;
          if (seenCursors.has(key) || rows.length === 0) throw new Error("Pagination made no progress");
          seenCursors.add(key); cursors.set(pool.address, cursor);
        }
      }
    }
    if (completed.size < pools.length) { result.truncated = true; result.stoppingReasons.push("1,000 received-record budget reached; includes duplicates and failed transactions"); }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Acquisition unavailable";
    result.errors.push(reason); result.stoppingReasons.push(reason);
    result.truncated = result.recordsReceived > 0 || reason.includes("budget");
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
  return finish();
}
