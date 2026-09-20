import type { AnalysisInput } from "./input";

/**
 * Shared synthetic inputs for the engine tests.
 *
 * The baseline is a deliberately healthy token: renounced authorities,
 * immutable metadata, dispersed holders, deep multi-pool liquidity, calm
 * trading and a long history. Tests override exactly the field under test, so
 * any change in severity is attributable to that field alone.
 *
 * Not a test file itself — it exports no tests and is never imported by
 * application code.
 */

export const DAY = 24 * 60 * 60 * 1000;

export function pair(
  overrides: Record<string, unknown> = {},
): AnalysisInput["marketData"]["pairs"][number] {
  return {
    dexId: "raydium",
    pairAddress: "pair",
    quoteSymbol: "SOL",
    liquidityUsd: 1_000_000,
    volume24hUsd: 200_000,
    priceUsd: 1,
    pairCreatedAt: Date.now() - 400 * DAY,
    fdv: 10_000_000,
    marketCap: 10_000_000,
    priceChange24h: 2,
    buys24h: 500,
    sells24h: 480,
    url: null,
    ...overrides,
  } as AnalysisInput["marketData"]["pairs"][number];
}

export function makeInput(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    mint: "So11111111111111111111111111111111111111112",
    mintInfo: {
      address: "So11111111111111111111111111111111111111112",
      tokenProgram: "spl-token",
      programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      decimals: 9,
      supplyRaw: "1000000000000000",
      supplyUi: 1_000_000,
      supplyIsMeaningful: true,
      mintAuthority: null,
      freezeAuthority: null,
      isInitialized: true,
      extensions: [],
      slot: 1,
    },
    metadata: {
      name: "Test Token",
      symbol: "TEST",
      uri: null,
      updateAuthority: null,
      isMutable: false,
      source: "metaplex",
      metadataAccount: "meta",
    },
    holderData: {
      available: true,
      holders: [],
      circulatingSupply: 1_000_000,
      pooledShare: 0.3,
      burnedShare: 0,
      topHolderShare: 0.02,
      top10Share: 0.1,
      next9Share: 0.08,
    },
    tokenAge: {
      available: true,
      oldestSignatureAt: Date.now() - 500 * DAY,
      ageDays: 500,
      isLowerBound: false,
      signaturesScanned: 120,
    },
    marketData: {
      available: true,
      name: "Test Token",
      symbol: "TEST",
      imageUrl: null,
      websites: [],
      socials: [],
      pairs: [
        pair({ liquidityUsd: 2_000_000, volume24hUsd: 500_000 }),
        pair({ liquidityUsd: 1_500_000, volume24hUsd: 300_000, dexId: "orca" }),
        pair({ liquidityUsd: 900_000, volume24hUsd: 100_000, dexId: "meteora" }),
      ],
    },
    ...overrides,
  };
}

/**
 * Archetypes used for calibration. Each is a realistic shape observed on
 * mainnet rather than an arbitrary combination, so the classification bands can
 * be pinned against cases that actually occur.
 */
export const ARCHETYPES = {
  /** Renounced, dispersed, deep liquidity, years old. */
  healthyBlueChip: () => makeInput(),

  /** Issuer retains mint and freeze authority by design; deep liquidity. */
  custodialStablecoin: () =>
    makeInput({
      mintInfo: {
        ...makeInput().mintInfo,
        mintAuthority: "Issuer1111111111111111111111111111111111",
        freezeAuthority: "Issuer1111111111111111111111111111111111",
      },
      metadata: { ...makeInput().metadata, isMutable: true, updateAuthority: "Issuer111" },
      holderData: {
        ...makeInput().holderData,
        topHolderShare: 0.12,
        next9Share: 0.2,
        top10Share: 0.32,
      },
    }),

  /** One wallet holds most of supply, but the tail is thin and liquidity deep. */
  singleWhale: () =>
    makeInput({
      holderData: {
        ...makeInput().holderData,
        topHolderShare: 0.727,
        next9Share: 0.152,
        top10Share: 0.879,
      },
    }),

  /** Days old, almost no liquidity, one pool — the shape the score must catch. */
  freshLowLiquidity: () =>
    makeInput({
      holderData: {
        ...makeInput().holderData,
        topHolderShare: 0.3729,
        next9Share: 0.4331,
        top10Share: 0.806,
      },
      tokenAge: {
        available: true,
        oldestSignatureAt: Date.now() - 1.2 * DAY,
        ageDays: 1.2,
        isLowerBound: false,
        signaturesScanned: 300,
      },
      marketData: {
        ...makeInput().marketData,
        pairs: [
          pair({
            liquidityUsd: 12_600,
            volume24hUsd: 30_000,
            marketCap: 2_000_000,
            fdv: 2_000_000,
            pairCreatedAt: Date.now() - 4.7 * DAY,
            priceChange24h: -20,
          }),
        ],
      },
    }),

  /** Every dimension compromised at once. */
  everyRedFlag: () =>
    makeInput({
      mintInfo: {
        ...makeInput().mintInfo,
        mintAuthority: "Deployer1111",
        freezeAuthority: "Deployer1111",
        tokenProgram: "spl-token-2022",
        extensions: [
          { extension: "permanentDelegate", state: { delegate: "Deployer1111" } },
        ],
      },
      metadata: { ...makeInput().metadata, isMutable: true, updateAuthority: "Deployer1111" },
      holderData: {
        ...makeInput().holderData,
        topHolderShare: 0.6,
        next9Share: 0.38,
        top10Share: 0.98,
      },
      tokenAge: {
        available: true,
        oldestSignatureAt: Date.now() - 0.5 * DAY,
        ageDays: 0.5,
        isLowerBound: false,
        signaturesScanned: 30,
      },
      marketData: {
        ...makeInput().marketData,
        pairs: [
          pair({
            liquidityUsd: 3_000,
            volume24hUsd: 400_000,
            marketCap: 40_000_000,
            fdv: 40_000_000,
            pairCreatedAt: Date.now() - 2 * 60 * 60 * 1000,
            priceChange24h: -92,
            buys24h: 40,
            sells24h: 600,
          }),
        ],
      },
    }),
} as const;
