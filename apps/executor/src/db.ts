import { Pool } from "pg";
import { config } from "./config";
import type { AllocationProposal, RebalanceOutcome } from "@steward/shared-types";

export const pool = new Pool({ connectionString: config.db.connectionString });

export async function recordRebalanceEvent(params: {
  vaultAddress: string;
  reasoningId: string;
  txHash: string | null;
  outcome: RebalanceOutcome;
  revertReason: string | null;
  proposal: AllocationProposal;
  executedAt: Date | null;
  swaps: { tokenIn: string; tokenOut: string; amountIn: bigint; amountOut: bigint }[];
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `insert into rebalance_events
        (vault_address, reasoning_id, tx_hash, outcome, revert_reason, proposed_at,
         executed_at, ai_reasoning, ai_confidence, target_weights, market_snapshot)
       values ($1, decode($2, 'hex'), $3, $4, $5, $6, $7, $8, $9, $10, $11)
       returning id`,
      [
        params.vaultAddress,
        params.reasoningId.replace(/^0x/, ""),
        params.txHash,
        params.outcome,
        params.revertReason,
        params.proposal.proposedAt,
        params.executedAt,
        params.proposal.reasoning,
        params.proposal.confidence,
        JSON.stringify(params.proposal.targetWeights),
        JSON.stringify(params.proposal.marketSnapshot),
      ]
    );

    const eventId = rows[0].id;

    for (const swap of params.swaps) {
      await client.query(
        `insert into rebalance_swaps (rebalance_event_id, token_in, token_out, amount_in, amount_out)
         values ($1, $2, $3, $4, $5)`,
        [eventId, swap.tokenIn, swap.tokenOut, swap.amountIn.toString(), swap.amountOut.toString()]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function recordValueSnapshot(vaultAddress: string, totalValueUsd: number): Promise<void> {
  await pool.query(
    `insert into vault_value_snapshots (vault_address, snapshot_at, total_value_usd)
     values ($1, now(), $2)
     on conflict do nothing`,
    [vaultAddress, totalValueUsd]
  );
}

export async function upsertVault(params: {
  address: string;
  ownerAddress: string;
  minRebalanceIntervalSeconds: number;
  maxSlippageBps: number;
}): Promise<void> {
  await pool.query(
    `insert into vaults (address, owner_address, min_rebalance_interval_seconds, max_slippage_bps)
     values ($1, $2, $3, $4)
     on conflict (address) do update set
       min_rebalance_interval_seconds = excluded.min_rebalance_interval_seconds,
       max_slippage_bps = excluded.max_slippage_bps`,
    [params.address, params.ownerAddress, params.minRebalanceIntervalSeconds, params.maxSlippageBps]
  );
}