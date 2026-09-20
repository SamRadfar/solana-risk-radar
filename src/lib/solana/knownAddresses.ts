/**
 * On-chain address labels used to interpret the top-holder list.
 *
 * Holder concentration is only meaningful once liquidity-pool vaults, burn
 * addresses and custodial exchange wallets are separated from ordinary
 * wallets: a pool vault holding 40% of supply is liquidity, not a whale.
 *
 * Program IDs are the primary mechanism (an account *owned by* a known AMM
 * program is a pool vault, whatever its address). The explicit address list is
 * a secondary aid for well-known custodians.
 */

export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const METAPLEX_METADATA_PROGRAM_ID =
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

/** Programs whose PDAs custody pooled liquidity. */
export const AMM_PROGRAM_IDS: Record<string, string> = {
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium AMM v4',
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: 'Raydium CLMM',
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: 'Raydium CPMM',
  routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS: 'Raydium Router',
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: 'Orca Whirlpool',
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP': 'Orca Swap v2',
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: 'Meteora DLMM',
  Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB: 'Meteora Pools',
  dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN: 'Meteora DBC',
  cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG: 'Meteora CP-AMM',
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: 'Pump.fun AMM',
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'Pump.fun',
  EewxydAPCCVuNEyrVN68PuSYdQ7wKn27V9Gjeoi8dy3S: 'Lifinity v2',
  PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY: 'Phoenix',
  srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX: 'OpenBook',
  opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb: 'OpenBook v2',
  SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ: 'Saber',
  MERLuDFBMmsHnsBPZw2sDQZHvXFMwp8EdjudcU2HKky: 'Mercurial',
  stkitrT1Uoy18Dk1fTrgPw8W6MVzoCfYoAFT4MLsmhq: 'Sanctum',
  '5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h': 'Stake Pool',
  obriQD1zbpyLz95G5n7nJe6a4DPjpFwa5XYPoNm113y: 'Obric',
  SoLFiHG9TfgtdUXUjWAxi3LtvYuFyDLVhBWxdMZxyCe: 'SolFi',
  ZERor4xhbUycZ6gb9ntrhqscUcZmAbQDjEAtCf4hbZY: 'ZeroFi',
  HumaWhaleHook111111111111111111111111111111: 'Transfer Hook (generic)',
};

/** Addresses that permanently remove tokens from circulation. */
export const BURN_ADDRESSES: Record<string, string> = {
  '1nc1nerator11111111111111111111111111111111': 'Incinerator (burn)',
  '11111111111111111111111111111111': 'System Program (unspendable)',
  So11111111111111111111111111111111111111112: 'Wrapped SOL mint',
  deadeadeadeadeadeadeadeadeadeadeadeadeadead: 'Dead address',
};

/** Well-known custodial wallets. Large balances here are customer deposits. */
export const CUSTODIAN_ADDRESSES: Record<string, string> = {
  '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM': 'Binance',
  '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9': 'Binance',
  '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S': 'Coinbase',
  H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS: 'Coinbase',
  '6QJzieMYfp7yr3EdrePaQoG3Ghxs2wM98xSLRu8Xh56U': 'Coinbase',
  AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2: 'Bybit',
  u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEsynXq2w: 'Gate.io',
  GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE: 'Crypto.com',
  '5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD': 'OKX',
  A77HErqtfN1hLLpvZ9pCtu66FEtM8BveoaKbbMoZ4RiR: 'Bitget',
  '2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm': 'Kraken',
};

export type HolderKind = 'pool' | 'burn' | 'custodian' | 'wallet' | 'contract';

export interface HolderLabel {
  kind: HolderKind;
  label: string | null;
}

/**
 * Classify a holder from its wallet address and the program that owns that
 * wallet account. Pool vaults are owned by an AMM program; ordinary wallets are
 * owned by the System Program.
 */
export function classifyHolder(
  ownerAddress: string,
  ownerAccountProgram: string | null,
  ownerAccountExecutable: boolean,
): HolderLabel {
  if (BURN_ADDRESSES[ownerAddress]) {
    return { kind: 'burn', label: BURN_ADDRESSES[ownerAddress] };
  }
  if (CUSTODIAN_ADDRESSES[ownerAddress]) {
    return { kind: 'custodian', label: CUSTODIAN_ADDRESSES[ownerAddress] };
  }
  if (ownerAccountProgram && AMM_PROGRAM_IDS[ownerAccountProgram]) {
    return { kind: 'pool', label: AMM_PROGRAM_IDS[ownerAccountProgram] };
  }
  if (ownerAccountExecutable) {
    return { kind: 'contract', label: 'Executable program' };
  }
  if (
    ownerAccountProgram &&
    ownerAccountProgram !== SYSTEM_PROGRAM_ID &&
    ownerAccountProgram !== TOKEN_PROGRAM_ID &&
    ownerAccountProgram !== TOKEN_2022_PROGRAM_ID
  ) {
    // Owned by some other on-chain program: a vault, escrow or custody PDA.
    return { kind: 'contract', label: 'Program-controlled account' };
  }
  return { kind: 'wallet', label: null };
}

export function explorerAccountUrl(address: string): string {
  return `https://solscan.io/account/${address}`;
}

export function explorerTokenUrl(mint: string): string {
  return `https://solscan.io/token/${mint}`;
}
