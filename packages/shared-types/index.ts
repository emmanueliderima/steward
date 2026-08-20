// Types shared across apps/executor, apps/indexer, apps/api, apps/web.
// Keep this package dependency-free (no ethers/viem imports) so it can be
// safely imported from the Next.js dashboard without pulling in node-only code.

export interface RiskParams {
  vaultAddress: `0x${string}`;
  allowedAssets: `0x${string}`[];
  maxAllocationBps: Record<`0x${string}`, number>; // asset -> bps (0-10000)
  maxSlippageBps: number;
  minRebalanceIntervalSeconds: number;
}

export interface AllocationProposal {
  vaultAddress: `0x${string}`;
  proposedAt: string; // ISO timestamp
  targetWeights: Record<`0x${string}`, number>; // asset -> bps
  reasoning: string; // full text explanation from the AI agent
  confidence: number; // 0-1
  marketSnapshot: {
    prices: Record<`0x${string}`, number>;
    sentimentScore?: number;
    sourcesUsed: string[];
  };
}

export type RebalanceOutcome = "executed" | "reverted" | "skipped_no_change";

export interface RebalanceRecord {
  id: string;
  vaultAddress: `0x${string}`;
  txHash: `0x${string}` | null;
  outcome: RebalanceOutcome;
  revertReason: string | null;
  recovered: boolean; // true if the indexer backfilled this from an on-chain
                       // event the executor never wrote — see apps/indexer
  proposedAt: string;
  executedAt: string | null;
  aiReasoning: string;
  aiConfidence: number | null; // null for recovered rows
  targetWeights: Record<`0x${string}`, number>;
  swaps: {
    tokenIn: `0x${string}`;
    tokenOut: `0x${string}`;
    amountIn: string; // stringified bigint
    amountOut: string;
  }[];
}

export interface AssetOverviewRow {
  address: `0x${string}`;
  symbol: string;
  currentPriceUsd: number;
  vaultAllocationBps: number;
  vaultValueUsd: number;
}

export interface DashboardSummary {
  vaultAddress: `0x${string}`;
  totalValueUsd: number;
  lastRebalanceAt: string | null;
  return30dPct: number | null;
  nextTriggerAt: string; // derived from lastRebalanceAt + minRebalanceInterval
  assets: AssetOverviewRow[];
}