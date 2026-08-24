import { ethers } from "ethers";
import {
  Vault__factory,
  VaultFactory__factory,
  IERC20Metadata__factory,
} from "@steward/contracts-sdk";
import { config } from "./config";
import * as db from "./db";

export const provider = new ethers.JsonRpcProvider(config.rpcUrl);

function* chunkRanges(from: number, to: number, size: number): Generator<[number, number]> {
  for (let start = from; start <= to; start += size) {
    yield [start, Math.min(start + size - 1, to)];
  }
}

async function readAndSyncRiskParams(vaultAddress: string): Promise<void> {
  const vault = Vault__factory.connect(vaultAddress, provider);
  const [owner, allowedAssets, maxSlippageBps, minRebalanceInterval] = await Promise.all([
    vault.owner(),
    vault.getAllowedAssets(),
    vault.maxSlippageBps(),
    vault.minRebalanceInterval(),
  ]);

  await db.upsertVault({
    address: vaultAddress,
    ownerAddress: owner,
    minRebalanceIntervalSeconds: Number(minRebalanceInterval),
    maxSlippageBps: Number(maxSlippageBps),
  });

  const assets = await Promise.all(
    allowedAssets.map(async (address) => {
      const [cap, symbol] = await Promise.all([
        vault.maxAllocationBps(address),
        IERC20Metadata__factory.connect(address, provider).symbol(),
      ]);
      return { address, symbol, maxAllocationBps: Number(cap) };
    })
  );

  await db.syncRiskParams(vaultAddress, assets);
}

/** Scans the factory for new vaults and syncs each one's initial risk params. */
export async function syncFactory(latestBlock: number): Promise<void> {
  const factory = VaultFactory__factory.connect(config.vaultFactoryAddress, provider);
  const streamKey = `factory:${config.vaultFactoryAddress}`;
  const from = await db.getLastProcessedBlock(streamKey);
  if (from > latestBlock) return;

  for (const [chunkFrom, chunkTo] of chunkRanges(from, latestBlock, config.logScanChunkSize)) {
    const events = await factory.queryFilter(factory.filters.VaultCreated(), chunkFrom, chunkTo);
    for (const event of events) {
      const vaultAddress = event.args.vault;
      console.log(`[factory] discovered new vault: ${vaultAddress}`);
      await readAndSyncRiskParams(vaultAddress);
    }
    await db.setLastProcessedBlock(streamKey, chunkTo + 1);
  }
}

/** Scans one vault for risk-param updates, deposits/withdrawals, and rebalances. */
export async function syncVault(vaultAddress: string, latestBlock: number): Promise<void> {
  const vault = Vault__factory.connect(vaultAddress, provider);
  const streamKey = `vault:${vaultAddress}`;
  const from = await db.getLastProcessedBlock(streamKey);
  if (from > latestBlock) return;

  for (const [chunkFrom, chunkTo] of chunkRanges(from, latestBlock, config.logScanChunkSize)) {
    const [riskUpdates, deposits, withdrawals, rebalances] = await Promise.all([
      vault.queryFilter(vault.filters.RiskParamsUpdated(), chunkFrom, chunkTo),
      vault.queryFilter(vault.filters.Deposited(), chunkFrom, chunkTo),
      vault.queryFilter(vault.filters.Withdrawn(), chunkFrom, chunkTo),
      vault.queryFilter(vault.filters.RebalanceExecuted(), chunkFrom, chunkTo),
    ]);

    if (riskUpdates.length > 0) {
      // Params changed at least once in this range — just re-read current
      // state rather than replaying each intermediate update.
      await readAndSyncRiskParams(vaultAddress);
    }

    for (const event of deposits) {
      await db.recordTransfer({
        vaultAddress,
        kind: "deposit",
        tokenAddress: event.args.token,
        amount: event.args.amount,
        txHash: event.transactionHash,
        blockNumber: event.blockNumber,
      });
    }

    for (const event of withdrawals) {
      await db.recordTransfer({
        vaultAddress,
        kind: "withdraw",
        tokenAddress: event.args.token,
        amount: event.args.amount,
        txHash: event.transactionHash,
        blockNumber: event.blockNumber,
      });
    }

    for (const event of rebalances) {
      const alreadyRecorded = await db.rebalanceEventExists(event.transactionHash);
      if (alreadyRecorded) continue; // the executor already wrote this one — normal case

      console.warn(
        `[vault ${vaultAddress}] RebalanceExecuted at tx ${event.transactionHash} has no ` +
          `matching Postgres record — the executor likely crashed before writing it. Recovering.`
      );

      const block = await event.getBlock();
      const { tokensIn, tokensOut, amountsIn, amountsOut } = event.args;
      const swaps = tokensIn.map((tokenIn: string, i: number) => ({
        tokenIn,
        tokenOut: tokensOut[i]!,
        amountIn: amountsIn[i]!,
        amountOut: amountsOut[i]!,
      }));

      if (swaps.length === 0) {
        console.warn(
          `[vault ${vaultAddress}] RebalanceExecuted at tx ${event.transactionHash} has no ` +
            `swaps — this is unexpected, but we'll still record it as a recovered rebalance.`
        );
      }

      await db.recordRecoveredRebalance({
        vaultAddress,
        txHash: event.transactionHash,
        blockTimestamp: new Date(block.timestamp * 1000),
        swaps,
      });
    }
    await db.setLastProcessedBlock(streamKey, chunkTo + 1);
  }
}
