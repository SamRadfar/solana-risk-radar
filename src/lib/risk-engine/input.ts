import type { MintInfo } from "../solana/mint";
import type { OnChainMetadata } from "../solana/metadata";
import type { HolderData } from "../solana/holders";
import type { TokenAge } from "../solana/age";
import type { MarketData } from "../market/types";
import type { LiquiditySafety } from "./types";

/** All raw data the risk engine needs, already fetched from providers. */
export interface AnalysisInput {
  mint: string;
  mintInfo: MintInfo;
  metadata: OnChainMetadata;
  holderData: HolderData;
  tokenAge: TokenAge;
  marketData: MarketData;
  /**
   * Verified LP lock and burn state.
   *
   * Carried on the input so the report can surface it, and deliberately *not*
   * read by any rule: this is evidence for the reader, not a scoring term. See
   * `RULES` in the engine — none of them takes this field.
   */
  liquiditySafety: LiquiditySafety;
}

/** A rule is a pure function of fetched data to a single signal. */
export type RiskRule = (input: AnalysisInput) => import("./types").RiskSignal;
