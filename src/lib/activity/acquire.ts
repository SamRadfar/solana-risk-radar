import { createHash } from "node:crypto";
import { normalizeActivity, object, list, text, integer } from "./normalize";
import { assessMetrics, eligibleFeatures, measureActivity, overallStatus } from "./measure";
import {
  ACTIVITY_VERSION, WINDOW_MS, MAX_POOLS, MAX_REQUESTS, BUDGET_MS, MAX_RESPONSE_BYTES, MAX_TOTAL_BYTES, MIN_ACTIONS, MIN_PARSER_COVERAGE,
  MIN_RESOLVED_ACTIONS, RETENTION_MS, SUPPORTED_PROGRAMS, SIGNATURES_PER_POOL, MAX_PARSED_RECORDS, PARSE_BATCH_MAX, PARSE_BATCH_MIN, PLANNING_RECORD_BYTES, PARSE_MIN_INTERVAL_MS,
} from "./policy";
import type { ActivityEvidenceResult, ActivityPool, ActivitySnapshot } from "./types";

export interface AcquisitionOptions { apiKey?: string; fetcher?: typeof fetch; now?: () => number; signal?: AbortSignal; parseIntervalMs?: number }
interface Listed { signature: string; slot: number; transactionIndex: number; blockTime: number; pools: Set<string> }

/** Entire discovery + RPC + listing + parse budget is shared. No retries or fallback crawl. */
export async function acquireActivity(mint: string, options: AcquisitionOptions = {}): Promise<ActivitySnapshot> {
  const now = options.now ?? Date.now, started = now(), fetchedAt = started;
  const snapshotId = createHash("sha256").update(`${ACTIVITY_VERSION}:${mint}:${started}`).digest("hex").slice(0, 24);
  const result: ActivityEvidenceResult = {
    version: ACTIVITY_VERSION, observationOnly: true, mint, snapshotId, status: "UNAVAILABLE",
    requestedWindow: { from: started - WINDOW_MS, to: started }, requestedWindowMs: WINDOW_MS, observedWindow: null,
    fetchedAt, expiresAt: fetchedAt + RETENTION_MS, elapsedMs: 0, requestCount: 0, bytesReceived: 0,
    failedTransactionFilter: "server-side-succeeded-only", signaturesListed: 0, signaturesNotFetched: 0,
    recordsReceived: 0, recordsExamined: 0, duplicateRecords: 0,
    economicActions: 0, successfulParses: 0, failedParses: 0, failedTransactions: 0, excludedRecords: 0,
    parserCoverage: null, resolvedTraderCount: 0, unresolvedTraderCount: 0, traderResolutionCoverage: null,
    poolsCovered: [], poolWindows: [], providersUsed: [], truncated: false, stoppingReasons: [], errors: [], exclusions: {}, metrics: null, features: null, evidence: [],
    limitations: [
      "Observation only; not included in score, coverage or categories.",
      "Selected supported pools only; token-wide venue completeness is unknown. Pool selection uses provider-reported liquidity, not proof of economic activity.",
      "Failed transactions are excluded server-side by a succeeded-only signature listing and are neither fetched nor counted.",
      "Resolved addresses are signing account controllers, not independent people or beneficial owners.",
      "No USD volume: concentration uses requested-token integer units. Quote deltas are retained only when unambiguous.",
      "Gross and net swap flows exclude other transfers; actual inventory change and economic profit remain unmeasured.",
      "Multi-root transactions, zero-net atomic routes, incomplete token-balance histories and unrecognized SOL transfers are not reconstructed.",
      "Repetition and cycling can reflect preset order sizes, arbitrage and market making; they establish no intent.",
      "Raw evidence is retained in a bounded process-local cache for five minutes; restart or eviction can remove it earlier.",
      `Every metric requires ${MIN_ACTIONS} normalized actions and ${MIN_PARSER_COVERAGE * 100}% parser coverage. Trader-dependent metrics (participants, concentration, cycling, inventory) additionally require ${MIN_RESOLVED_ACTIONS} actions in the resolved-trader subset and describe that subset only, with its action and volume coverage disclosed. These are data-quality gates, not risk thresholds.`,
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
      result.metrics = assessMetrics(result);
      result.features = eligibleFeatures(measureActivity(result.evidence), result.metrics);
      result.status = overallStatus(result.metrics);
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
          size += value.byteLength; result.bytesReceived += value.byteLength;
          if (size > MAX_RESPONSE_BYTES || result.bytesReceived > MAX_TOTAL_BYTES) throw new Error("Response-byte budget exhausted");
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
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(options.apiKey)}`;
  try {
    const discovered = await json(`https://api.dexscreener.com/token-pairs/v1/solana/${encodeURIComponent(mint)}`, "dexscreener");
    if (!Array.isArray(discovered)) throw new Error("Pool discovery returned an invalid schema");
    const candidates = [...new Map(discovered.map(object).filter(p => p.chainId === "solana" && text(p.pairAddress) &&
      (object(p.baseToken).address === mint || object(p.quoteToken).address === mint) && object(p.baseToken).address !== object(p.quoteToken).address)
      .sort((a, b) => Number(object(b.liquidity).usd ?? 0) - Number(object(a.liquidity).usd ?? 0) || String(a.pairAddress).localeCompare(String(b.pairAddress)))
      .map(p => [String(p.pairAddress), p])).values()].slice(0, 20);
    if (!candidates.length) throw new Error("No identified pools returned for requested mint");
    const rpc = object(await json(rpcUrl, "helius-rpc", {
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

    // 1. Successful signatures only (server-side `status: succeeded`): failed transactions never
    //    consume parse, byte or record capacity. One bounded listing per pool, no pagination.
    const listed = new Map<string, Listed>(), listingComplete = new Map<string, boolean>();
    let frontierSlot = -1;
    for (const pool of pools) {
      const listing = object(await json(rpcUrl, "helius-rpc", {
        jsonrpc: "2.0", id: 1, method: "getTransactionsForAddress", params: [pool.address, {
          transactionDetails: "signatures", sortOrder: "desc", limit: SIGNATURES_PER_POOL, commitment: "finalized",
          filters: { status: "succeeded", blockTime: { gte: Math.floor(result.requestedWindow.from / 1000), lte: Math.floor(result.requestedWindow.to / 1000) } },
        }],
      }));
      const data = object(listing.result).data;
      if (listing.error || !Array.isArray(data)) throw new Error("Successful-signature listing unavailable");
      if (data.length > SIGNATURES_PER_POOL) throw new Error("Signature listing exceeded requested limit");
      if (!result.poolsCovered.some(p => p.address === pool.address)) result.poolsCovered.push(pool);
      let oldest = Infinity;
      for (const entry of data.map(object)) {
        const signature = text(entry.signature), slot = integer(entry.slot), blockTime = integer(entry.blockTime);
        if (!signature || slot === null || blockTime === null) throw new Error("Signature listing returned an invalid entry");
        oldest = Math.min(oldest, slot);
        // Defensive: the filter should make this unreachable. Never fetch a failed transaction.
        if (entry.err != null) { result.failedTransactions++; continue; }
        const existing = listed.get(signature);
        if (existing) { result.duplicateRecords++; existing.pools.add(pool.address); continue; }
        listed.set(signature, { signature, slot, blockTime, transactionIndex: integer(entry.transactionIndex) ?? 0, pools: new Set([pool.address]) });
      }
      const complete = data.length < SIGNATURES_PER_POOL;
      listingComplete.set(pool.address, complete);
      // A truncated listing only proves completeness above its oldest slot (that slot may be partial).
      if (!complete) {
        frontierSlot = Math.max(frontierSlot, oldest);
        result.stoppingReasons.push(`${pool.venue} ${pool.address} has at least ${SIGNATURES_PER_POOL} successful signatures in the requested window; all pools are analysed above the common complete-listing frontier only`);
      }
    }
    result.signaturesListed = listed.size;
    const queue = [...listed.values()].filter(s => s.slot > frontierSlot)
      .sort((a, b) => b.slot - a.slot || b.transactionIndex - a.transactionIndex || a.signature.localeCompare(b.signature));
    const beyondFrontier = listed.size - queue.length;

    // 2. Parse newest-first, contiguous. Each batch is sized so that even at the largest observed
    //    live record size it cannot overrun the per-response or remaining total byte cap.
    const fetched: Listed[] = [];
    let budgetStop: string | null = null, lastParseAt: number | null = null;
    const interval = options.parseIntervalMs ?? PARSE_MIN_INTERVAL_MS;
    while (fetched.length < queue.length) {
      const byteRoom = Math.min(MAX_RESPONSE_BYTES, MAX_TOTAL_BYTES - result.bytesReceived);
      const size = Math.min(PARSE_BATCH_MAX, queue.length - fetched.length, MAX_PARSED_RECORDS - result.recordsReceived, Math.floor(byteRoom / PLANNING_RECORD_BYTES));
      if (result.recordsReceived >= MAX_PARSED_RECORDS) { budgetStop = `${MAX_PARSED_RECORDS} parsed-record budget reached`; break; }
      if (size < Math.min(PARSE_BATCH_MIN, queue.length - fetched.length, MAX_PARSED_RECORDS - result.recordsReceived)) { budgetStop = "Response-byte planning budget reached"; break; }
      if (result.requestCount >= MAX_REQUESTS) { budgetStop = "Request-count budget reached"; break; }
      const batch = queue.slice(fetched.length, fetched.length + size);
      // Pacing, not retry: stay under the provider's per-second limit. Aborts with the deadline.
      const wait = lastParseAt === null ? 0 : lastParseAt + interval - Date.now();
      if (wait > 0) await new Promise<void>(resolve => {
        const pause = setTimeout(resolve, wait);
        controller.signal.addEventListener("abort", () => { clearTimeout(pause); resolve(); }, { once: true });
      });
      lastParseAt = Date.now();
      const rows = await json(`https://mainnet.helius-rpc.com/v1/parsed-events/transactions?api-key=${encodeURIComponent(options.apiKey)}`, "helius-parsed-events", {
        transactions: batch.map(s => s.signature), commitment: "finalized", includeRawTransaction: true,
      });
      if (!Array.isArray(rows) || rows.length !== batch.length || rows.some((row, i) => object(row).signature !== batch[i].signature)) {
        throw new Error("Helius parse response did not match requested signatures");
      }
      fetched.push(...batch);
      for (const row of rows) {
        result.recordsReceived++;
        const signature = String(object(row).signature), time = integer(object(object(row).parsed).blockTime);
        raw[signature] = row;
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
        } else {
          if (normalized.kind === "unparsed") result.failedParses++;
          else if (normalized.kind === "failed") result.failedTransactions++;
          else result.excludedRecords++;
          result.exclusions[normalized.reason] = (result.exclusions[normalized.reason] ?? 0) + 1;
        }
      }
    }
    result.signaturesNotFetched = listed.size - fetched.length;
    if (budgetStop) result.stoppingReasons.push(`${budgetStop}; ${queue.length - fetched.length} newer-to-older listed successful signatures not fetched`);
    if (beyondFrontier) result.stoppingReasons.push(`${beyondFrontier} listed successful signatures below the common complete-listing frontier not fetched`);
    const unfetched = new Set(queue.slice(fetched.length).concat([...listed.values()].filter(s => s.slot <= frontierSlot)).flatMap(s => [...s.pools]));
    for (const window of result.poolWindows) {
      const times = fetched.filter(s => s.pools.has(window.pool)).map(s => s.blockTime * 1000);
      window.oldestRecordAt = times.length ? Math.min(...times) : null;
      window.reachedWindowStart = listingComplete.get(window.pool) === true && !unfetched.has(window.pool);
    }
    result.truncated = result.poolWindows.some(p => !p.reachedWindowStart);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Acquisition unavailable";
    result.errors.push(reason); result.stoppingReasons.push(reason);
    result.truncated = result.recordsReceived > 0 || reason.includes("budget");
    result.signaturesNotFetched = Math.max(0, result.signaturesListed - result.recordsReceived);
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
  return finish();
}
