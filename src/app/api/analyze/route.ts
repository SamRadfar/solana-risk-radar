import { NextResponse, type NextRequest } from "next/server";

import { validateMintAddress } from "@/lib/solana/address";
import {
  AccountNotFoundError,
  NotAMintError,
  getMintInfo,
} from "@/lib/solana/mint";
import { getOnChainMetadata } from "@/lib/solana/metadata";
import { getHolderData } from "@/lib/solana/holders";
import { getTokenAge } from "@/lib/solana/age";
import { hasPrivateEndpoint } from "@/lib/solana/rpc";
import {
  getMarketData,
  marketCap,
  marketIdentity,
  spotPrice,
} from "@/lib/providers/dexscreener";
import { buildRiskReport } from "@/lib/risk-engine/engine";
import { getCached, setCached } from "@/lib/cache";
import type {
  DataSourceStatus,
  RiskReport,
  TokenOverview,
} from "@/lib/risk-engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The single analysis endpoint.
 *
 * All provider access lives on the server: RPC endpoints (and any configured
 * private one) are never exposed to the browser, and every external response is
 * treated as untrusted input before it reaches the risk engine.
 */
export async function GET(request: NextRequest) {
  const started = Date.now();
  const raw = request.nextUrl.searchParams.get("address") ?? "";

  const validation = validateMintAddress(raw);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }
  const mintAddress = validation.address;

  // A repeat lookup within the TTL is served from memory. Holder scanning is
  // slow on public RPC, so this makes re-inspecting a token feel instant and
  // avoids hammering a free endpoint.
  const cached = getCached<RiskReport>(mintAddress);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "private, max-age=15", "X-Cache": "hit" },
    });
  }

  // The mint account gates everything else: without it there is nothing to
  // analyse, and its decimals/supply are inputs to the other fetches.
  let mintInfo;
  try {
    mintInfo = await getMintInfo(mintAddress);
  } catch (error) {
    if (error instanceof NotAMintError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof AccountNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      {
        error: `Could not read the mint account from any Solana RPC endpoint. ${
          error instanceof Error ? error.message : ""
        }`.trim(),
      },
      { status: 502 },
    );
  }

  // Independent lookups run concurrently. Each already degrades to an
  // "unavailable" result internally, so one slow provider cannot fail the
  // report — it only reduces coverage.
  const [metadata, holderData, tokenAge, marketData] = await Promise.all([
    getOnChainMetadata(mintInfo).catch(() => ({
      name: null,
      symbol: null,
      uri: null,
      updateAuthority: null,
      isMutable: null,
      source: "none" as const,
      metadataAccount: null,
    })),
    getHolderData(mintInfo),
    getTokenAge(mintAddress),
    getMarketData(mintAddress),
  ]);

  /*
   * Listing metadata is taken from a market the consensus accepted, so the
   * links shown belong to the same evidence the price does.
   */
  const identity = marketIdentity(marketData);

  const overview: TokenOverview = {
    mint: mintAddress,
    // On-chain metadata is authoritative for identity; the market aggregator is
    // only a fallback for tokens whose metadata account is missing.
    name: metadata.name ?? marketData.name,
    symbol: metadata.symbol ?? marketData.symbol,
    decimals: mintInfo.decimals,
    supply: mintInfo.supplyRaw,
    supplyUi: mintInfo.supplyUi,
    supplyIsMeaningful: mintInfo.supplyIsMeaningful,
    priceUsd: spotPrice(marketData),
    marketCapUsd: marketCap(
      marketData,
      mintInfo.supplyIsMeaningful ? mintInfo.supplyUi : undefined,
    ),
    imageUrl: identity.imageUrl,
    tokenProgram: mintInfo.tokenProgram,
    metadataSource: metadata.source,
    websites: identity.websites,
    socials: identity.socials,
  };

  const sources: DataSourceStatus[] = [
    {
      name: "Solana RPC",
      detail: hasPrivateEndpoint()
        ? `Mint account read at slot ${mintInfo.slot} via the configured endpoint`
        : `Mint account read at slot ${mintInfo.slot} via public endpoints`,
      ok: true,
    },
    {
      name: "Token holders",
      detail: holderData.available
        ? `${holderData.holders.length} largest accounts resolved and classified`
        : (holderData.error ?? "Unavailable"),
      ok: holderData.available,
    },
    {
      name: "On-chain metadata",
      detail:
        metadata.source === "none"
          ? "No metadata account found for this mint"
          : `Read from ${metadata.source === "metaplex" ? "the Metaplex metadata account" : "the Token-2022 metadata extension"}`,
      ok: metadata.source !== "none",
    },
    {
      name: "DexScreener",
      detail: marketData.available
        ? `${marketData.pairs.length} pool${marketData.pairs.length === 1 ? "" : "s"} indexed`
        : (marketData.error ?? "Unavailable"),
      ok: marketData.available,
    },
    {
      name: "Mint history",
      detail: tokenAge.available
        ? `${tokenAge.signaturesScanned} signatures scanned`
        : (tokenAge.error ?? "Unavailable"),
      ok: tokenAge.available,
    },
  ];

  const report = buildRiskReport(
    { mint: mintAddress, mintInfo, metadata, holderData, tokenAge, marketData },
    { overview, sources, elapsedMs: Date.now() - started },
  );

  setCached(mintAddress, report);

  return NextResponse.json(report, {
    headers: { "Cache-Control": "private, max-age=15", "X-Cache": "miss" },
  });
}
