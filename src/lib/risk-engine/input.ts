import type { MintInfo } from "../solana/mint";
import type { OnChainMetadata } from "../solana/metadata";
import type { HolderData } from "../solana/holders";
import type { TokenAge } from "../solana/age";
import type { MarketData } from "../providers/dexscreener";

/** All raw data the risk engine needs, already fetched from providers. */
export interface AnalysisInput {
  mint: string;
  mintInfo: MintInfo;
  metadata: OnChainMetadata;
  holderData: HolderData;
  tokenAge: TokenAge;
  marketData: MarketData;
}

/** A rule is a pure function of fetched data to a single signal. */
export type RiskRule = (input: AnalysisInput) => import("./types").RiskSignal;
