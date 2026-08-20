import { Pool } from "pg";
import { config } from "./config";
import type { RebalanceRecord, RiskParams } from "@steward/shared-types";

export const pool = new Pool({ connectionString: config.databaseUrl });

export async function getVaultsByOwner(ownerAddress: string): Promise<string[]> {
  const { rows } = await pool.query("select address from vaults where owner_address = $1", [
    ownerAddress,
  ]);
  return rows.map((r) => r.address);
}

export async function getRiskParams(vaultAddress: string): Promise<RiskParams | null> {
  const vaultResult = await pool.query(
    "select min_rebalance_interval_seconds, max_slippage_bps from vaults where address = $1",
    [vaultAddress]
  );
  if (vaultResult.rows.length === 0) return null;

  const paramsResult = await pool.query(
    "select asset_address, max_allocation_bps from vault_risk_params where vault_address = $1",
    [vaultAddress]
  );

  const maxAllocationBps: Record<string, number> = {};
  for (const row of paramsResult.rows) {
    maxAllocationBps[row.asset_address] = row.max_allocation_bps;
  }

  return {
    vaultAddress: vaultAddress as `0x${string}`,
    allowedAssets: paramsResult.rows.map((r) => r.asset_address) as `0x${string}`[],
    maxAllocationBps: maxAllocationBps as Record<`0x${string}`, number>,
    maxSlippageBps: vaultResult.rows[0].max_slippage_bps,
    minRebalanceIntervalSeconds: vaultResult.rows[0].min_rebalance_interval_seconds,
  };
}

export async function getLastRebalance(
  vaultAddress: string
): Promise<{ executedAt: Date } | null> {
  const { rows } = await pool.query(
    `select executed_at from rebalance_events
     where vault_address = $1 and outcome = 'executed'
     order by executed_at desc limit 1`,
    [vaultAddress]
  );
  return rows.length > 0 ? { executedAt: rows[0].executed_at } : null;
}

/**
 * Returns null (not 0) when there isn't at least one snapshot ~30 days old
 * to compare against — a vault that's only a few days old has no real
 * 30-day return yet, and reporting 0% would be misleading, not honest.
 */
export async function get30dReturnPct(vaultAddress: string): Promise<number | null> {
  const [earliest, latest] = await Promise.all([
    pool.query(
      `select total_value_usd from vault_value_snapshots
       where vault_address = $1 and snapshot_at <= now() - interval '30 days'
       order by snapshot_at desc limit 1`,
      [vaultAddress]
    ),
    pool.query(
      `select total_value_usd from vault_value_snapshots
       where vault_address = $1
       order by snapshot_at desc limit 1`,
      [vaultAddress]
    ),
  ]);

  if (earliest.rows.length === 0 || latest.rows.length === 0) return null;

  const startValue = Number(earliest.rows[0].total_value_usd);
  const endValue = Number(latest.rows[0].total_value_usd);
  if (startValue === 0) return null;

  return ((endValue - startValue) / startValue) * 100;
}

export async function getRebalanceHistory(
  vaultAddress: string,
  limit: number
): Promise<RebalanceRecord[]> {
  const { rows } = await pool.query(
    `select
       re.id, re.tx_hash, re.outcome, re.revert_reason, re.recovered,
       re.proposed_at, re.executed_at, re.ai_reasoning, re.ai_confidence, re.target_weights,
       coalesce(
         json_agg(
           json_build_object(
             'tokenIn', rs.token_in, 'tokenOut', rs.token_out,
             'amountIn', rs.amount_in, 'amountOut', rs.amount_out
           )
         ) filter (where rs.id is not null),
         '[]'
       ) as swaps
     from rebalance_events re
     left join rebalance_swaps rs on rs.rebalance_event_id = re.id
     where re.vault_address = $1
     group by re.id
     order by re.proposed_at desc
     limit $2`,
    [vaultAddress, limit]
  );

  return rows.map((row) => ({
    id: row.id,
    vaultAddress: vaultAddress as `0x${string}`,
    txHash: row.tx_hash,
    outcome: row.outcome,
    revertReason: row.revert_reason,
    recovered: row.recovered,
    proposedAt: row.proposed_at.toISOString(),
    executedAt: row.executed_at ? row.executed_at.toISOString() : null,
    aiReasoning: row.ai_reasoning,
    aiConfidence: row.ai_confidence === null ? null : Number(row.ai_confidence),
    targetWeights: row.target_weights,
    swaps: row.swaps,
  }));
}

export async function getTransferHistory(vaultAddress: string, limit: number) {
  const { rows } = await pool.query(
    `select kind, token_address, amount, tx_hash, block_number, occurred_at
     from vault_transfers
     where vault_address = $1
     order by occurred_at desc
     limit $2`,
    [vaultAddress, limit]
  );
  return rows.map((r) => ({
    kind: r.kind,
    tokenAddress: r.token_address,
    amount: r.amount,
    txHash: r.tx_hash,
    blockNumber: Number(r.block_number),
    occurredAt: r.occurred_at.toISOString(),
  }));
}