import "server-only";

/**
 * Minimal Solana JSON-RPC client with endpoint failover.
 *
 * Why not `@solana/web3.js`'s `Connection`: we need per-endpoint failover and
 * tight timeouts, and we only use a handful of read methods. A small client
 * keeps the server route fast and the failure modes explicit.
 *
 * Endpoint order:
 *   1. `SOLANA_RPC_URL` — a private endpoint (Helius/QuickNode/Triton). Optional.
 *   2. Public endpoints that are known to serve the account-scanning methods
 *      (`getTokenLargestAccounts`) that most free tiers block.
 *
 * The endpoint list lives here rather than in the callers so a provider can be
 * swapped without touching any analysis code.
 */

const DEFAULT_ENDPOINTS = [
  // Serves getTokenLargestAccounts without an API key (verified).
  "https://public.rpc.solanavibestation.com",
  // Official public endpoint. Rate-limits account-scanning methods, but is a
  // reliable fallback for single-account reads.
  "https://api.mainnet-beta.solana.com",
  "https://rpc.solanatracker.io/public",
];

export function rpcEndpoints(): string[] {
  const configured = process.env.SOLANA_RPC_URL?.trim();
  return configured ? [configured, ...DEFAULT_ENDPOINTS] : DEFAULT_ENDPOINTS;
}

/** True when a private endpoint is configured, surfaced in the API response. */
export function hasPrivateEndpoint(): boolean {
  return Boolean(process.env.SOLANA_RPC_URL?.trim());
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

const REQUEST_TIMEOUT_MS = 12_000;

type JsonRpcResponse<T> = {
  result?: T;
  error?: { code: number; message: string };
};

async function callEndpoint<T>(
  endpoint: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new RpcError(
        `${method} failed with HTTP ${response.status}`,
        response.status,
      );
    }

    // Some endpoints return HTML error pages with a 200 status.
    const text = await response.text();
    let payload: JsonRpcResponse<T>;
    try {
      payload = JSON.parse(text) as JsonRpcResponse<T>;
    } catch {
      throw new RpcError(`${method} returned a non-JSON response`);
    }

    if (payload.error) {
      throw new RpcError(payload.error.message, payload.error.code);
    }
    if (payload.result === undefined) {
      throw new RpcError(`${method} returned an empty result`);
    }

    return payload.result;
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rate limiting is transient and worth waiting out; a bad request is not. */
function isRetryable(error: unknown): boolean {
  if (!(error instanceof RpcError)) return true; // transport/parse errors
  if (error.code === 429) return true;
  if (error.code !== undefined && error.code >= 500) return true;
  return /rate|too many|timeout|non-JSON|empty result/i.test(error.message);
}

/**
 * Call a Solana RPC method, trying each endpoint in turn.
 *
 * Free public endpoints rate-limit the account-scanning methods hard, and a
 * single analysis issues several calls in quick succession, so each endpoint
 * gets a couple of attempts with backoff before moving on. Without this the
 * first 429 would silently drop holder analysis from the report.
 *
 * A `null` result is a legitimate answer (an account that does not exist), so
 * it is returned as-is rather than treated as a failure.
 */
export async function rpcCall<T>(
  method: string,
  params: unknown[],
  { attemptsPerEndpoint = 3 }: { attemptsPerEndpoint?: number } = {},
): Promise<T> {
  const endpoints = rpcEndpoints();
  const failures: string[] = [];

  for (const endpoint of endpoints) {
    for (let attempt = 0; attempt < attemptsPerEndpoint; attempt += 1) {
      try {
        return await callEndpoint<T>(endpoint, method, params);
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "unknown transport error";

        if (!isRetryable(error) || attempt === attemptsPerEndpoint - 1) {
          failures.push(`${hostOf(endpoint)}: ${reason}`);
          break;
        }
        // 400ms, 1200ms — enough to clear a per-second bucket.
        await sleep(400 * 3 ** attempt);
      }
    }
  }

  throw new RpcError(
    `Solana RPC method "${method}" failed on all ${endpoints.length} endpoints (${failures.join("; ")})`,
  );
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "invalid-endpoint";
  }
}

// ---------------------------------------------------------------------------
// Typed shapes for the subset of RPC responses we consume.
// ---------------------------------------------------------------------------

export interface RpcAccount<TData> {
  data: TData;
  executable: boolean;
  lamports: number;
  owner: string;
  space?: number;
}

export interface RpcContextValue<T> {
  context: { slot: number; apiVersion?: string };
  value: T;
}

export interface ParsedAccountData<TInfo> {
  parsed: { info: TInfo; type: string };
  program: string;
  space: number;
}

export type Base64AccountData = [string, "base64"];

export interface TokenLargestAccount {
  address: string;
  amount: string;
  decimals: number;
  uiAmount: number | null;
  uiAmountString: string;
}

export function getAccountInfoParsed<TInfo>(
  address: string,
): Promise<RpcContextValue<RpcAccount<ParsedAccountData<TInfo>> | null>> {
  return rpcCall("getAccountInfo", [address, { encoding: "jsonParsed" }]);
}

export function getAccountInfoBase64(
  address: string,
): Promise<RpcContextValue<RpcAccount<Base64AccountData> | null>> {
  return rpcCall("getAccountInfo", [address, { encoding: "base64" }]);
}

export function getTokenLargestAccounts(
  mint: string,
): Promise<RpcContextValue<TokenLargestAccount[]>> {
  return rpcCall("getTokenLargestAccounts", [mint]);
}

export function getMultipleAccountsParsed<TInfo>(
  addresses: string[],
): Promise<RpcContextValue<(RpcAccount<ParsedAccountData<TInfo>> | null)[]>> {
  return rpcCall("getMultipleAccounts", [addresses, { encoding: "jsonParsed" }]);
}

/** Full account data, batched. Used to decode AMM pool state. */
export function getMultipleAccountsBase64(
  addresses: string[],
): Promise<RpcContextValue<(RpcAccount<Base64AccountData> | null)[]>> {
  return rpcCall("getMultipleAccounts", [addresses, { encoding: "base64" }]);
}

/** Account headers only — `dataSlice` keeps the response small. */
export function getMultipleAccountOwners(
  addresses: string[],
): Promise<RpcContextValue<(RpcAccount<Base64AccountData> | null)[]>> {
  return rpcCall("getMultipleAccounts", [
    addresses,
    { encoding: "base64", dataSlice: { offset: 0, length: 0 } },
  ]);
}
