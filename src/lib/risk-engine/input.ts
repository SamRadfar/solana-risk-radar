import type { MintInfo } from "../solana/mint";
import type { HolderData } from "../solana/holders";
import type { MarketData } from "../providers/dexscreener";

/** All raw data the risk engine needs, already fetched from providers. */
export interface AnalysisInput {
  mint: string;
  mintInfo: MintInfo;
  holderData: HolderData;
  marketData: MarketData;
}
