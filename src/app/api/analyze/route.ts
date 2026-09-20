import { NextRequest, NextResponse } from "next/server";
import { validateSolanaAddress } from "@/lib/solana/validate";
import { getMintInfo, NotAMintError, AccountNotFoundError } from "@/lib/solana/mint";
import { getOnChainMetadata } from "@/lib/solana/metadata";
import { getHolderData } from "@/lib/solana/holders";
import { getMarketData } from "@/lib/providers/dexscreener";
import { buildRiskReport } from "@/lib/risk-engine/engine";
import type { TokenOverview } from "@/lib/risk-engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address") ?? "";

  const validation = validateSolanaAddress(address);
  if (!validation.valid || !validation.publicKey) {
    return NextResponse.json({ error: validation.error ?? "Invalid address." }, { status: 400 });
  }
  const mintKey = validation.publicKey;
  const mintAddress = mintKey.toBase58();

  let mintInfo;
  try {
    mintInfo = await getMintInfo(mintKey);
  } catch (err) {
    if (err instanceof NotAMintError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof AccountNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : "Unknown error fetching mint account.";
    return NextResponse.json(
      { error: `Failed to read mint account from Solana RPC: ${message}` },
      { status: 502 },
    );
  }

  const [onChainMetadata, holderData, marketData] = await Promise.all([
    getOnChainMetadata(mintKey).catch(() => ({ name: null, symbol: null, uri: null })),
    getHolderData(mintKey, mintInfo.supplyRaw),
    getMarketData(mintAddress),
  ]);

  const overview: TokenOverview = {
    mint: mintAddress,
    name: marketData.name ?? onChainMetadata.name,
    symbol: marketData.symbol ?? onChainMetadata.symbol,
    decimals: mintInfo.decimals,
    supply: mintInfo.supplyRaw,
    supplyUi: mintInfo.supplyUi,
    priceUsd: marketData.pairs.find((p) => p.priceUsd !== null)?.priceUsd ?? null,
    imageUrl: marketData.imageUrl,
  };

  const report = buildRiskReport({ mint: mintAddress, mintInfo, holderData, marketData }, overview);

  return NextResponse.json(report, {
    headers: { "Cache-Control": "private, max-age=15" },
  });
}
