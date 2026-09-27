import { describe, it, expect } from "vitest";
import captured from "./fixtures/bonk-wif-2026-09-27.json";
import { normalizeDexScreener } from "../providers/dexscreener";
import { normalizeGeckoPools, normalizeGeckoToken } from "../providers/gecko-market";
import { providerConsensus } from "./consensus";
import { validateMarket } from "./validation";
import type { ProviderSnapshot } from "./types";

describe("captured BONK/WIF calibration", () => {
  it.each(captured.tokens)("$name: zero-volume stale venue quotes cannot veto active markets", token => {
    const now = Date.parse(token.dex.at);
    const dex = normalizeDexScreener(token.dex.data, token.mint, now);
    const opinion = providerConsensus(dex, [], now);
    const inactive = opinion.observations.filter(o => o.volume24hUsd === 0 && (o.liquidityUsd ?? 0) >= 250);
    expect(inactive.length).toBeGreaterThan(0);
    expect(inactive.every(o => !o.accepted && o.rejection?.includes("Zero reported"))).toBe(true);
    if (token.name === "WIF") expect(opinion.status).toBe("usable");
  });
  it("BONK: internally contradictory SAROS conversion is rejected, not outvoted", () => {
    const token = captured.tokens.find(t => t.name === "BONK")!;
    const now = Date.parse(token.pools.at);
    const observations = normalizeGeckoPools(token.pools.data, token.mint, now);
    const snapshot: ProviderSnapshot = { provider: "geckoterminal", mint: token.mint, available: true,
      fetchedAt: now, observations, token: normalizeGeckoToken(token.gecko.data.data, now, token.gecko.url), errors: [] };
    const opinion = providerConsensus(snapshot, [], now);
    const anomaly = opinion.observations.find(o => o.pairAddress === "HmQL6eECoaGLWvTxz6cWT3jEsPfjdin2vNVJ1xKiwjXz")!;
    expect(anomaly.priceUsd).toBeGreaterThan(.00002);
    expect(anomaly.accepted).toBe(false);
    expect(anomaly.rejection).toContain("internally inconsistent");
    expect(opinion.status).toBe("usable");
    expect(opinion.priceUsd).toBeLessThan(.000004);
    // One repaired provider is still only one source, never validation.
    expect(validateMarket(token.mint, [snapshot], [], now, null).status).toBe("single_source");
  });
});
