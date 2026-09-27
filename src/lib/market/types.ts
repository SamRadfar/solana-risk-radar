export type ValidationState = "validated" | "single_source" | "conflict" | "unavailable";
export type MarketConfidence = "high" | "medium" | "low" | "none";
export type TokenSide = "base" | "quote";

export interface MetricEvidence {
  provider: string;
  value: number | null;
  fetchedAt: number;
  reason?: string;
}

/** Only `validated` measurements have a publishable `value`. */
export interface ValidatedMetric {
  status: ValidationState;
  value: number | null;
  reason: string;
  sources: MetricEvidence[];
  disagreement: number | null;
}

export interface PoolObservation {
  provider: string;
  chain: string | null;
  dexId: string;
  pairAddress: string | null;
  requestedMint: string;
  baseAddress: string | null;
  baseSymbol: string | null;
  baseName?: string | null;
  quoteAddress: string | null;
  quoteSymbol: string | null;
  quoteName?: string | null;
  side: TokenSide | null;
  counterMint: string | null;
  trustedCounterMint: boolean;
  /** Original base/quote ratio; never silently inverted. */
  priceNative: number | null;
  /** Counter units per requested token, with orientation proven. */
  requestedNativeRatio: number | null;
  reportedPriceUsd: number | null;
  /** Same-response counter USD, when supplied; consistency is not corroboration. */
  reportedCounterPriceUsd?: number | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  reportedChange24h: number | null;
  priceChange24h: number | null;
  buys24h: number | null;
  sells24h: number | null;
  pairCreatedAt: number | null;
  marketCap: number | null;
  fdv: number | null;
  fetchedAt: number;
  providerUpdatedAt: number | null;
  sourceUrl: string;
  identityError: string | null;
  info: { imageUrl: string | null; websites: string[]; socials: string[] };
}

export interface TokenReference {
  provider: string;
  mint: string;
  priceUsd: number;
  marketCap: number | null;
  fetchedAt: number;
  sourceUrl: string;
}

export interface ProviderSnapshot {
  provider: string;
  mint: string;
  available: boolean;
  fetchedAt: number;
  observations: PoolObservation[];
  /**
   * Pools fetched by address because ANOTHER provider listed them. They can
   * corroborate that pool's identity/metrics but never vote on price.
   */
  lookups?: PoolObservation[];
  token: TokenReference | null;
  errors: string[];
}

export interface ObservationDecision extends PoolObservation {
  accepted: boolean;
  rejection: string | null;
  /** True for by-address lookup rows: pool corroboration only, no price vote. */
  lookup?: boolean;
  correlationKey: string;
  /** Each quote dependency contributes at most one unit; USD depth has no vote. */
  weight: number;
  nativeCheck: {
    status: "consistent" | "conflict" | "unavailable";
    referenceProvider: string | null;
    counterPriceUsd: number | null;
    expectedPriceUsd: number | null;
    disagreement: number | null;
  };
}

export interface ProviderOpinion {
  provider: string;
  mint: string;
  available: boolean;
  fetchedAt: number;
  status: "usable" | "conflict" | "unavailable";
  priceUsd: number | null;
  candidatePrices: number[];
  clusters: { min: number; max: number; dependencies: string[]; pools: string[] }[];
  token: TokenReference | null;
  priceChange24h: number | null;
  changeConflict: boolean;
  impliedCirculating: number | null;
  circulationConflict: boolean;
  dispersion: number | null;
  groups: { counterMint: string; count: number; priceUsd: number; conflict: boolean }[];
  observations: ObservationDecision[];
  errors: string[];
}

/** Projected, corroborated pool metrics consumed by LP reads and market rules. */
export interface MarketPair {
  dexId: string;
  pairAddress: string | null;
  quoteSymbol: string | null;
  liquidityUsd: number;
  volume24hUsd: number | null;
  priceUsd: number | null;
  pairCreatedAt: number | null;
  fdv: number | null;
  marketCap: number | null;
  priceChange24h: number | null;
  buys24h: number | null;
  sells24h: number | null;
  url: string | null;
  info: PoolObservation["info"];
}

export interface PricePoint { t: number; p: number }
export interface PriceHistory {
  events?: string[];
  available: boolean;
  points: PricePoint[];
  pool: string | null;
  mint: string;
  side: TokenSide | null;
  fetchedAt: number;
  sourceUrl: string | null;
  error?: string;
}

export interface MarketValidation {
  version: string;
  mint: string;
  evaluatedAt: number;
  status: ValidationState;
  confidence: MarketConfidence;
  price: ValidatedMetric;
  marketCap: ValidatedMetric;
  fdv: ValidatedMetric;
  change24h: ValidatedMetric;
  liquidity: ValidatedMetric;
  volume24h: ValidatedMetric;
  activity: ValidatedMetric;
  providers: ProviderOpinion[];
  counterReferences: { requestedMints: string[]; observations: TokenReference[]; error: string | null };
  pairs: MarketPair[];
  poolDecisions: { pairAddress: string; accepted: boolean; reason: string; liquidity: ValidatedMetric; volume24h: ValidatedMetric; buys: ValidatedMetric; sells: ValidatedMetric;
    /** Same-pool 24h return (gross, 1 + %/100) corroborated across providers. */
    change24h: ValidatedMetric }[];
  historyPool: { pairAddress: string; dexId: string } | null;
  history: PriceHistory | null;
  historyCheck: { status: "consistent" | "conflict" | "unavailable"; reason: string; disagreement: number | null };
  /** Which corroborated pools each subset metric was measured on. */
  volumeSubset: SubsetCoverage | null;
  activitySubset: (SubsetCoverage & { buys: number; sells: number }) | null;
  change24hSubset: SubsetCoverage | null;
  /** By-address pool corroboration lookup, when performed. Diagnostics only. */
  poolLookup?: { requested: number; returned: number; error: string | null };
  circulatingSupply: number | null;
  totalSupplyUi: number | null;
}

/** A metric measured on a subset of the corroborated pools, with honest coverage. */
export interface SubsetCoverage {
  poolsMeasured: number;
  poolsCorroborated: number;
  /** Corroborated reserves of the measured pools; the compatible denominator for ratios. */
  liquidityUsd: number;
  /** Measured pools' share of all corroborated reserves, 0-1. */
  liquidityShare: number;
  excluded: { pairAddress: string; reason: string }[];
}

/** Raw availability is distinct from market validation; absence never bypasses it. */
export interface MarketData {
  available: boolean;
  pairs: MarketPair[];
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  websites: string[];
  socials: string[];
  error?: string;
  validation?: MarketValidation;
}
