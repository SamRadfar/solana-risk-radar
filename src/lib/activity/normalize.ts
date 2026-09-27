import { PublicKey } from "@solana/web3.js";
import { SUPPORTED_PROGRAMS, TIP_ACCOUNTS } from "./policy";
import { decodeBase58 } from "../solana/address";
import { createHash } from "node:crypto";
import type { ActivityPool, ActivityTrade, AncillarySolTransfer } from "./types";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
const SYSTEM_TRANSFER = 2, SYNC_NATIVE = 17;

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const text = (value: unknown): string | null => typeof value === "string" && value.length > 0 ? value : null;
export const integer = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
export function rawAmount(value: unknown): bigint | null {
  // Never round an unsafe JSON number into apparently exact on-chain units.
  if (typeof value === "string" && /^\d{1,80}$/.test(value)) return BigInt(value);
  return integer(value) !== null ? BigInt(value as number) : null;
}
type Outcome = { kind: "trade"; trade: ActivityTrade } | { kind: "failed" | "unparsed" | "excluded"; reason: string };
type Instruction = Record<string, unknown>;

function wrappedSolAccount(owner: string, tokenProgram: string): string | null {
  try {
    return PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(), new PublicKey(tokenProgram).toBuffer(), new PublicKey(WRAPPED_SOL).toBuffer()],
      new PublicKey(ASSOCIATED_TOKEN_PROGRAM))[0].toBase58();
  } catch { return null; }
}
const executionOrder = (ix: Instruction) => Number(ix.instructionIndex) * 10_000 + (ix.innerInstructionIndex === null ? -1 : Number(ix.innerInstructionIndex));

/** Classify one System Program instruction outside the swap root from raw bytes/accounts only.
 * Accepted: zero-value transfers; signer self-wraps into its own derived WSOL ATA followed by
 * sync_native; signer tips to documented block-builder tip accounts that take no other role.
 * Anything else that can move lamports stays an unallocated transfer.
 */
function classifySystemInstruction(ix: Instruction, instructions: Instruction[], signers: Set<string>, tradeAccounts: Set<string>):
  { kind: "neutral" } | { kind: "ancillary"; transfer: AncillarySolTransfer } | { kind: "unallocated" } {
  const bytes = typeof ix.rawData === "string" ? decodeBase58(ix.rawData) : null;
  if (!bytes || bytes.length < 4) return { kind: "unallocated" };
  const data = Buffer.from(bytes);
  if (data.readUInt32LE(0) !== SYSTEM_TRANSFER) return /transfer/i.test(String(ix.instructionName)) ? { kind: "unallocated" } : { kind: "neutral" };
  const accounts = list(ix.rawAccounts).map(text);
  const from = accounts[0], to = accounts[1];
  if (data.length !== 12 || !from || !to) return { kind: "unallocated" };
  const lamports = data.readBigUInt64LE(4);
  if (lamports === BigInt(0)) return { kind: "ancillary", transfer: { kind: "zero-value", lamports: "0", recipient: to, service: null } };
  if (!signers.has(from)) return { kind: "unallocated" };
  const isSyncNative = (sync: Instruction) => {
    const syncData = typeof sync.rawData === "string" ? decodeBase58(sync.rawData) : null;
    return TOKEN_PROGRAMS.includes(String(sync.programId)) && list(sync.rawAccounts)[0] === to && executionOrder(sync) > executionOrder(ix) &&
      syncData?.length === 1 && syncData[0] === SYNC_NATIVE;
  };
  if (TOKEN_PROGRAMS.some(program => wrappedSolAccount(from, program) === to) && instructions.some(isSyncNative)) {
    return { kind: "ancillary", transfer: { kind: "self-wrap", lamports: lamports.toString(), recipient: to, service: null } };
  }
  if (TIP_ACCOUNTS[to] && !tradeAccounts.has(to) && !signers.has(to)) {
    return { kind: "ancillary", transfer: { kind: "tip", lamports: lamports.toString(), recipient: to, service: TIP_ACCOUNTS[to] } };
  }
  return { kind: "unallocated" };
}

/** One transaction / one economic action only when there is one swap root.
 * CPI legs are evidence of that root, never independently counted user trades.
 * Multi-root bundles and atomic zero-net cycles are explicitly unsupported.
 */
export function normalizeActivity(row: unknown, mint: string, pools: ActivityPool[], snapshotId: string): Outcome {
  const envelope = object(row), parsed = object(envelope.parsed), raw = object(envelope.rawTransaction);
  if (parsed.transactionStatus === "ERROR" || object(raw.meta).err != null) return { kind: "failed", reason: "Transaction execution failed" };
  if (envelope.parserStatus !== "OK") return { kind: "unparsed", reason: "Provider parser did not return OK" };
  const signature = text(envelope.signature), slot = integer(parsed.slot), blockTime = integer(parsed.blockTime);
  const tx = object(raw.transaction), meta = object(raw.meta), message = object(tx.message);
  if (!signature || slot === null || blockTime === null || parsed.transactionStatus !== "OK" || meta.err !== null || list(tx.signatures)[0] !== signature || raw.slot !== slot || raw.blockTime !== blockTime) {
    return { kind: "unparsed", reason: "Missing or inconsistent raw transaction identity/status/time" };
  }
  const instructions = list(parsed.instructions).map(object);
  const staticKeys = list(message.accountKeys).map(k => typeof k === "string" ? k : text(object(k).pubkey));
  const loaded = object(meta.loadedAddresses);
  const allKeys = [...staticKeys, ...list(loaded.writable), ...list(loaded.readonly)];
  if (instructions.length > 256 || allKeys.length > 256 || list(meta.preTokenBalances).length > 256 || list(meta.postTokenBalances).length > 256 || instructions.some(ix => typeof ix.rawData !== "string" || ix.rawData.length > 4096)) {
    return { kind: "unparsed", reason: "Transaction exceeds supported decoder shape limits" };
  }
  const rawInstructions = list(message.instructions).map((ix, index) => ({ ix: object(ix), root: index, inner: null as number | null }));
  for (const group of list(meta.innerInstructions).map(object)) {
    for (const [index, ix] of list(group.instructions).entries()) rawInstructions.push({ ix: object(ix), root: Number(group.index), inner: index });
  }
  // Refuse omitted or inconsistent instructions. Decoded labels alone cannot
  // establish the program, pool membership, or completeness of a transaction.
  if (!rawInstructions.length || rawInstructions.length !== instructions.length || rawInstructions.some(({ ix, root, inner }) => {
    const matches = instructions.filter(p => p.instructionIndex === root && p.innerInstructionIndex === inner);
    const p = matches[0], programIndex = integer(ix.programIdIndex);
    const accounts = list(ix.accounts).map(i => typeof i === "number" ? allKeys[i] : i);
    return matches.length !== 1 || !p || programIndex === null || p.programId !== allKeys[programIndex] ||
      typeof ix.data !== "string" || ix.data !== p.rawData || JSON.stringify(accounts) !== JSON.stringify(p.rawAccounts);
  })) return { kind: "unparsed", reason: "Raw/parsed instruction coverage or identity mismatch" };
  const legs = instructions.flatMap(ix => {
    const program = text(ix.programId), policy = program ? SUPPORTED_PROGRAMS[program] : null;
    if (!policy || !policy.swaps.includes(String(ix.instructionName))) return [];
    const decoded = object(ix.decoded), poolAccount = list(decoded.accounts).map(object).find(a => a.name === policy.poolField);
    const pool = pools.find(p => p.program === program && p.address === poolAccount?.pubkey && list(ix.rawAccounts).includes(p.address));
    const bytes = typeof ix.rawData === "string" ? decodeBase58(ix.rawData) : null;
    const discriminator = createHash("sha256").update(`global:${ix.instructionName}`).digest().subarray(0, 8);
    return pool && bytes && Buffer.from(bytes.subarray(0, 8)).equals(discriminator) && integer(ix.instructionIndex) !== null ? [{ ix, pool }] : [];
  });
  if (!legs.length) return instructions.some(ix => object(ix.summary).type === "swap")
    ? { kind: "unparsed", reason: "Swap could not be bound to a supported identified pool" }
    : { kind: "excluded", reason: "No supported, identified pool swap instruction" };
  const roots = new Set(legs.map(l => l.ix.instructionIndex));
  const root = [...roots][0];
  if (roots.size !== 1) return { kind: "unparsed", reason: "Multiple economic roots or unallocated transfers" };
  const keys = staticKeys;
  const required = integer(object(message.header).numRequiredSignatures);
  if (required === null || required === 0 || required > keys.length || list(tx.signatures).length !== required) return { kind: "unparsed", reason: "Raw signer header is incomplete or inconsistent" };
  const signers = new Set(keys.filter((k, i): k is string => !!k && i < required));
  const pre = list(meta.preTokenBalances).map(object), post = list(meta.postTokenBalances).map(object);
  const rootAccounts = new Set(instructions.filter(ix => ix.instructionIndex === root).flatMap(ix => list(ix.rawAccounts)));
  const balanceAccounts = [...pre, ...post].flatMap(b => [integer(b.accountIndex) !== null ? allKeys[Number(b.accountIndex)] : null, b.owner]);
  const tradeAccounts = new Set([...rootAccounts, ...balanceAccounts, ...pools.map(p => p.address)].filter((a): a is string => typeof a === "string"));
  // Also reject another (possibly unsupported) swap root and unrelated token
  // transfers: whole-transaction balance deltas cannot allocate these safely.
  // get_account_data_size is the value-free Token CPI inside ATA creation (live Helius naming).
  // System Program instructions are classified from raw bytes, not by name.
  const ancillarySolTransfers: AncillarySolTransfer[] = [];
  let unallocatedSol = false;
  const otherEconomicInstruction = instructions.some(ix => {
    if (ix.instructionIndex === root) return false;
    if (object(ix.summary).type === "swap") return true;
    if (ix.programId === SYSTEM_PROGRAM) {
      const classified = classifySystemInstruction(ix, instructions, signers, tradeAccounts);
      if (classified.kind === "ancillary") ancillarySolTransfers.push(classified.transfer);
      if (classified.kind === "unallocated") unallocatedSol = true;
      return classified.kind === "unallocated";
    }
    return /transfer|mint_to|burn|liquidity/i.test(String(ix.instructionName)) ||
      TOKEN_PROGRAMS.includes(String(ix.programId)) && !/initialize|close|sync_native|get_account_data_size/i.test(String(ix.instructionName));
  });
  if (otherEconomicInstruction) return { kind: "unparsed", reason: unallocatedSol
    ? "Unallocated SOL transfer (not zero-value, a verified self-wrap or a documented tip account)" : "Multiple economic roots or unallocated transfers" };
  // A self-wrap into a WSOL account that persists across the transaction adds lamports to its
  // token balance outside the swap, so that account's WSOL delta is not swap flow.
  const wrapped = new Set(ancillarySolTransfers.filter(t => t.kind === "self-wrap").map(t => t.recipient));
  const wrapContaminated = [...pre, ...post].some(b => integer(b.accountIndex) !== null && wrapped.has(String(allKeys[Number(b.accountIndex)])));
  // A missing side cannot be assumed zero: new/closed token accounts need
  // instruction-scoped reconstruction, deferred to a future decoder version.
  const mintDecimals = new Set([...pre, ...post].filter(b => b.mint === mint).map(b => integer(object(b.uiTokenAmount).decimals)));
  if (mintDecimals.size !== 1 || mintDecimals.has(null)) return { kind: "unparsed", reason: "Missing or inconsistent requested-token decimals" };
  const deltas = new Map<string, Map<string, { amount: bigint; decimals: number }>>();
  let incomplete = wrapContaminated;
  const indices = new Set([...pre, ...post].map(b => b.accountIndex));
  for (const index of indices) {
    const before = pre.find(b => b.accountIndex === index), after = post.find(b => b.accountIndex === index);
    if (integer(index) === null || !allKeys[Number(index)] || pre.filter(b => b.accountIndex === index).length > 1 || post.filter(b => b.accountIndex === index).length > 1) { incomplete = true; continue; }
    if (!before || !after || !text(before.owner) || before.owner !== after.owner || before.mint !== after.mint) { incomplete = true; continue; }
    const b = object(before.uiTokenAmount), a = object(after.uiTokenAmount);
    const beforeAmount = rawAmount(b.amount), afterAmount = rawAmount(a.amount), decimals = integer(a.decimals);
    if (beforeAmount === null || afterAmount === null || decimals === null || decimals > 255 || b.decimals !== decimals) { incomplete = true; continue; }
    const owner = String(before.owner), token = text(before.mint);
    if (!token) { incomplete = true; continue; }
    const assets = deltas.get(owner) ?? new Map<string, { amount: bigint; decimals: number }>();
    const previous = assets.get(token);
    if (previous && previous.decimals !== decimals) { incomplete = true; continue; }
    assets.set(token, { amount: (previous?.amount ?? BigInt(0)) + afterAmount - beforeAmount, decimals });
    deltas.set(owner, assets);
  }
  const candidates = [...deltas].filter(([owner, assets]) => signers.has(owner) && rootAccounts.has(owner) && (assets.get(mint)?.amount ?? BigInt(0)) !== BigInt(0) &&
    !pools.some(p => p.address === owner || p.program === owner));
  const candidate = candidates.length === 1 ? candidates[0] : null;
  const base = candidate?.[1].get(mint);
  // All signed requested-token movements must be attributable to the same root.
  const quotes = candidate && base ? [...candidate[1]].filter(([token, d]) => token !== mint && d.amount !== BigInt(0) && (d.amount > BigInt(0)) !== (base.amount > BigInt(0))) : [];
  const quote = quotes.length === 1 ? quotes[0] : null;
  const resolved = !!candidate && !!base && !!quote && !incomplete && [...candidate[1].values()].filter(d => d.amount !== BigInt(0)).length === 2;
  const rootInstruction = instructions.find(ix => ix.instructionIndex === root && ix.innerInstructionIndex === null);
  const summary = object(object(rootInstruction?.summary ?? parsed.summary).parsedData);
  const input = text(summary.input_mint), output = text(summary.output_mint);
  if (input && input === output) return { kind: "unparsed", reason: "Atomic same-asset route cannot be reconstructed as a directional trade" };
  const summaryBase = output === mint ? rawAmount(summary.actual_out_amount) : input === mint ? rawAmount(summary.in_amount) : null;
  const decimals = base?.decimals ?? [...pre, ...post].filter(b => b.mint === mint).map(b => integer(object(b.uiTokenAmount).decimals)).find(d => d !== null);
  const amount = resolved && base ? (base.amount < BigInt(0) ? -base.amount : base.amount) : summaryBase;
  if (amount === null || amount === undefined || amount <= BigInt(0) || decimals === undefined || decimals === null) return { kind: "unparsed", reason: "Economic amount cannot be reconstructed (including zero-net atomic routes)" };
  const side = resolved && base ? base.amount > BigInt(0) ? "BUY" : "SELL" : output === mint && input !== mint ? "BUY" : input === mint && output !== mint ? "SELL" : "UNKNOWN";
  return { kind: "trade", trade: {
    signature, slot, blockTime, success: true, mint,
    pools: [...new Set(legs.map(l => l.pool.address))], programs: [...new Set(legs.map(l => l.pool.program))],
    traderAddress: resolved ? candidate![0] : null,
    traderResolutionStatus: resolved ? "RESOLVED" : candidate ? "PARTIAL" : "UNRESOLVED",
    traderResolutionProvenance: resolved ? "Unique signing token-account owner with opposing requested-token/quote deltas; single economic root. This is account control, not beneficial identity." : "Ownership or flow allocation is ambiguous; fee payer is not used as trader.",
    side, baseAmountRaw: amount.toString(), baseDecimals: decimals,
    quoteAmountRaw: resolved && quote ? (quote[1].amount < BigInt(0) ? -quote[1].amount : quote[1].amount).toString() : null,
    quoteMint: resolved && quote ? quote[0] : null,
    quoteDecimals: resolved && quote ? quote[1].decimals : null,
    amountProvenance: resolved ? "raw-transaction-token-balance-deltas" : "provider-root-swap-summary; unresolved owner",
    ancillarySolTransfers,
    economicActionId: `${signature}:${root}`, source: "helius-parsed-events", rawEvidenceReference: `${snapshotId}:${signature}`,
  } };
}
