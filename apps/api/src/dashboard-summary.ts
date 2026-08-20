import { ethers } from "ethers";
import type { DashboardSummary, AssetOverviewRow } from "@steward/shared-types";
import { readLiveVaultState } from "./chain";
import { fetchPrices } from "./prices";
import * as db from "./db";

export async function buildDashboardSummary(vaultAddress: string): Promise<DashboardSummary> {
  const state = await readLiveVaultState(vaultAddress);

  const prices = await fetchPrices(
    state.allowedAssets.map((a) => ({ address: a, symbol: state.symbols[a]! }))
  );

  let totalValueUsd = 0;
  const valueUsdByAsset: Record<string, number> = {};
  for (const asset of state.allowedAssets) {
    const price = prices[asset] ?? 0;
    const human = Number(ethers.formatUnits(state.balances[asset]!, state.decimals[asset]));
    valueUsdByAsset[asset] = human * price;
    totalValueUsd += valueUsdByAsset[asset];
  }

  const assets: AssetOverviewRow[] = state.allowedAssets.map((asset) => ({
    address: asset as `0x${string}`,
    symbol: state.symbols[asset]!,
    currentPriceUsd: prices[asset] ?? 0,
    vaultAllocationBps: totalValueUsd > 0 ? Math.round((valueUsdByAsset[asset]! / totalValueUsd) * 10_000) : 0,
    vaultValueUsd: valueUsdByAsset[asset]!,
  }));

  const [lastRebalance, return30dPct] = await Promise.all([
    db.getLastRebalance(vaultAddress),
    db.get30dReturnPct(vaultAddress),
  ]);

  // If it's never rebalanced, it's due now — not at some arbitrary future
  // point derived from a rebalance that hasn't happened.
  const nextTriggerAt = lastRebalance
    ? new Date(lastRebalance.executedAt.getTime() + state.minRebalanceIntervalSeconds * 1000).toISOString()
    : new Date().toISOString();

  return {
    vaultAddress: vaultAddress as `0x${string}`,
    totalValueUsd,
    lastRebalanceAt: lastRebalance ? lastRebalance.executedAt.toISOString() : null,
    return30dPct,
    nextTriggerAt,
    assets,
  };
}