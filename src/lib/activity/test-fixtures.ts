import { createHash } from "node:crypto";
import type { ActivityPool } from "./types";

// Synthetic contract fixtures shaped from Helius Parsed Events documentation.
// They are not captured mainnet data and do not establish live parser coverage.
export const MINT = "So11111111111111111111111111111111111111112";
export const QUOTE = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const NOW = 1_790_500_000_000;
export const POOLS: ActivityPool[] = [0, 1].map(i => ({
  address: `pool-${i}`, program: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
  venue: "Raydium CPMM", baseMint: MINT, quoteMint: QUOTE,
}));
function instructionData(name: string): string {
  const bytes = createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt(`0x${bytes.toString("hex")}`), encoded = "";
  while (n > BigInt(0)) { encoded = alphabet[Number(n % BigInt(58))] + encoded; n /= BigInt(58); }
  for (const byte of bytes) { if (byte !== 0) break; encoded = "1" + encoded; }
  return encoded;
}
export function transaction(id: number, options: { wallet?: string; side?: "BUY" | "SELL"; amount?: string; routed?: boolean; pool?: number; unresolved?: boolean; failed?: boolean; parserError?: boolean; sameSlot?: number } = {}) {
  const owner = options.wallet ?? `wallet-${id}`, side = options.side ?? (id % 2 ? "SELL" : "BUY"), amount = BigInt(options.amount ?? "1000");
  const signature = `signature-${id}`, slot = options.sameSlot ?? 10000 + id, blockTime = NOW / 1000 - 1800 + id;
  const selected = options.routed ? POOLS : [POOLS[options.pool ?? 0]];
  const program = options.routed ? "router-program" : selected[0].program;
  const keys = ["sponsor-fee-payer", owner, "base-account", "quote-account", program, ...selected.map(p => p.address), ...(options.routed ? [selected[0].program] : [])];
  const rawAccounts = keys.filter((_, i) => i !== 4 && i !== keys.length - (options.routed ? 1 : 0));
  const summary = { type: "swap", parsedData: { type: "swap", input_mint: side === "BUY" ? QUOTE : MINT, output_mint: side === "BUY" ? MINT : QUOTE, in_amount: side === "BUY" ? "500" : amount.toString(), actual_out_amount: side === "BUY" ? amount.toString() : "500" } };
  const root = { instructionIndex: 0, innerInstructionIndex: null as number | null, programId: program, rawAccounts, rawData: instructionData(options.routed ? "route" : "swap_base_input"), instructionName: options.routed ? "route" : "swap_base_input", summary, decoded: { accounts: [{ name: "pool_state", pubkey: selected[0].address }] } };
  const instructions = [root, ...(options.routed ? selected.map((pool, i) => ({ ...root, innerInstructionIndex: i, programId: pool.program, instructionName: "swap_base_input", rawData: instructionData("swap_base_input"), decoded: { accounts: [{ name: "pool_state", pubkey: pool.address }] } })) : [])];
  const compiled = (ix: typeof root) => ({ programIdIndex: keys.indexOf(ix.programId), accounts: ix.rawAccounts.map(k => keys.indexOf(k)), data: ix.rawData });
  const balance = (mint: string, index: number, n: bigint) => ({ accountIndex: index, mint, owner, uiTokenAmount: { amount: n.toString(), decimals: mint === MINT ? 9 : 6 } });
  const start = amount * BigInt(100), delta = side === "BUY" ? amount : -amount;
  return {
    signature, parserStatus: options.parserError ? "ERROR" : "OK",
    parsed: { slot, blockTime, feePayer: keys[0], transactionStatus: options.failed ? "ERROR" : "OK", instructions, summary },
    rawTransaction: { slot, blockTime, transaction: { signatures: options.unresolved ? [signature] : [signature, "controller-signature"], message: { accountKeys: keys, header: { numRequiredSignatures: options.unresolved ? 1 : 2 }, instructions: [compiled(root)] } },
      meta: { err: options.failed ? { InstructionError: [0, "Custom"] } : null,
        innerInstructions: options.routed ? [{ index: 0, instructions: instructions.slice(1).map(compiled) }] : [],
        preTokenBalances: [balance(MINT, 2, start), balance(QUOTE, 3, BigInt(100000))],
        postTokenBalances: [balance(MINT, 2, start + delta), balance(QUOTE, 3, BigInt(100000) + (side === "BUY" ? -BigInt(500) : BigInt(500)))],
      },
    },
  };
}
export function mockProvider(rows: ReturnType<typeof transaction>[], options: { pools?: number; rateLimit?: boolean; endless?: boolean; requestError?: boolean } = {}) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input), body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url, body });
    if (options.requestError) throw new Error(`secret-key leaked in URL ${url}`);
    if (url.includes("dexscreener")) return Response.json(POOLS.slice(0, options.pools ?? 1).map(p => ({ chainId: "solana", pairAddress: p.address, baseToken: { address: MINT }, quoteToken: { address: QUOTE }, liquidity: { usd: 100 } })));
    if (body.method === "getMultipleAccounts") return Response.json({ result: { value: POOLS.slice(0, options.pools ?? 1).map(p => ({ owner: p.program, executable: false })) } });
    if (options.rateLimit) return new Response("limited", { status: 429 });
    const start = Number(body.paginationToken ?? 0), end = start + Number(body.limit);
    return Response.json({ data: rows.slice(start, end), ...(end < rows.length || options.endless ? { paginationToken: String(end) } : {}) });
  };
  return { fetcher, calls };
}
