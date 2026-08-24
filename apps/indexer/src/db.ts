import { Pool } from "pg";
import { config } from "./config";

export const pool = new Pool({ connectionString: config.databaseUrl });

export async function getLastProcessedBlock(streamKey: string): Promise<number> {
  const { rows } = await pool.query(
    "select last_processed_block from indexer_state where stream_key = $1",
    [streamKey]
  );
  // Checkpoints represent the next block to scan. Ignore any block-zero
  // checkpoint left behind by an earlier empty GENESIS_BLOCK configuration.
  return rows.length > 0
    ? Math.max(Number(rows[0].last_processed_block), config.genesisBlock)
    : config.genesisBlock;
}

export async function setLastProcessedBlock(streamKey: string, block: number): Promise<void> {
  await pool.query(
    `insert into indexer_state (stream_key, last_processed_block)
     values ($1, $2)
     on conflict (stream_key) do update set last_processed_block = excluded.last_processed_block`,
    [streamKey, block]
  );
}

export async function listKnownVaults(): Promise<string[]> {
  const { rows } = await pool.query("select address from vaults");
  return rows.map((r) => r.address);
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

/**
 * Replaces this vault's stored risk params wholesale — simpler and less
 * error-prone than diffing per-asset, and this only runs on VaultCreated or
 * RiskParamsUpdated events, which are infrequent.
 */
export async function syncRiskParams(
  vaultAddress: string,
  assets: { address: string; symbol: string; maxAllocationBps: number }[]
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("delete from vault_risk_params where vault_address = $1", [vaultAddress]);
    for (const asset of assets) {
      await client.query(
        `insert into vault_risk_params (vault_address, asset_address, asset_symbol, max_allocation_bps)
         values ($1, $2, $3, $4)`,
        [vaultAddress, asset.address, asset.symbol, asset.maxAllocationBps]
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

export async function recordTransfer(params: {
  vaultAddress: string;
  kind: "deposit" | "withdraw";
  tokenAddress: string;
  amount: bigint;
  txHash: string;
  blockNumber: number;
}): Promise<void> {
  await pool.query(
    `insert into vault_transfers (vault_address, kind, token_address, amount, tx_hash, block_number)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      params.vaultAddress,
      params.kind,
      params.tokenAddress,
      params.amount.toString(),
      params.txHash,
      params.blockNumber,
    ]
  );
}

export async function rebalanceEventExists(txHash: string): Promise<boolean> {
  const { rows } = await pool.query("select 1 from rebalance_events where tx_hash = $1", [txHash]);
  return rows.length > 0;
}

/**
 * Backfills a RebalanceExecuted event the executor never wrote to Postgres
 * itself — most likely because it crashed between confirming the tx and
 * writing its own record. The AI reasoning that only ever lived in the
 * executor's memory at proposal time is genuinely gone; `recovered: true`
 * says so honestly instead of inventing a plausible-looking explanation.
 */
export async function recordRecoveredRebalance(params: {
  vaultAddress: string;
  txHash: string;
  blockTimestamp: Date;
  swaps: { tokenIn: string; tokenOut: string; amountIn: bigint; amountOut: bigint }[];
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `insert into rebalance_events
        (vault_address, reasoning_id, tx_hash, outcome, proposed_at, executed_at,
         ai_reasoning, ai_confidence, recovered, target_weights, market_snapshot)
       values ($1, '\\x00', $2, 'executed', $3, $3,
               '(recovered from chain — original AI reasoning was not recorded)', null, true, '{}', '{}')
       returning id`,
      [params.vaultAddress, params.txHash, params.blockTimestamp]
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
