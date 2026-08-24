import cron from "node-cron";
import { ethers } from "ethers";
import { config } from "./config";
import { listAllVaults, readVaultState, isDueForRebalance, submitRebalance } from "./chain";
import { fetchPrices, fetchSentiment } from "./marketData";
import { proposeAllocation } from "./aiAgent";
import { planRebalanceLegs, buildSwapInstruction } from "./rebalancePlanner";
import { recordRebalanceEvent, recordValueSnapshot, upsertVault } from "./db";

async function processVault(vaultAddress: string): Promise<void> {
  const state = await readVaultState(vaultAddress);

  await upsertVault({
    address: state.address,
    ownerAddress: state.owner,
    minRebalanceIntervalSeconds: state.minRebalanceInterval,
    maxSlippageBps: state.maxSlippageBps,
  });

  const prices = await fetchPrices(
    state.allowedAssets.map((address) => ({ address, symbol: state.symbols[address]! }))
  );
  const missingPrices = state.allowedAssets.filter((a) => prices[a] === undefined);
  if (missingPrices.length > 0) {
    console.warn(`[${vaultAddress}] missing prices for ${missingPrices.join(", ")}, skipping this cycle`);
    return;
  }

  let totalValueUsd = 0;
  for (const asset of state.allowedAssets) {
    const human = Number(ethers.formatUnits(state.balances[asset]!, state.decimals[asset]));
    totalValueUsd += human * prices[asset]!;
  }
  await recordValueSnapshot(state.address, totalValueUsd);

  if (!isDueForRebalance(state)) {
    console.log(`[${vaultAddress}] not due yet, skipping`);
    return;
  }

  const totalAllocationCapacity = state.allowedAssets.reduce(
    (sum, asset) => sum + state.maxAllocationBps[asset]!,
    0
  );
  if (totalAllocationCapacity < 10_000) {
    console.warn(
      `[${vaultAddress}] allocation caps total ${totalAllocationCapacity}bps; ` +
        "at least 10000bps is required. Owner must update vault settings; skipping this cycle."
    );
    return;
  }

  const sentiment = await fetchSentiment();
  const currentWeightsBps: Record<string, number> = {};
  for (const asset of state.allowedAssets) {
    const human = Number(ethers.formatUnits(state.balances[asset]!, state.decimals[asset]));
    const valueUsd = human * prices[asset]!;
    currentWeightsBps[asset] = totalValueUsd > 0 ? Math.round((valueUsd / totalValueUsd) * 10_000) : 0;
  }

  const proposal = await proposeAllocation({
    vaultAddress: state.address,
    assets: state.allowedAssets.map((a) => ({
      address: a,
      symbol: state.symbols[a]!,
      priceUsd: prices[a]!,
      maxAllocationBps: state.maxAllocationBps[a]!,
    })),
    currentWeightsBps,
    sentiment,
  });

  const reasoningId = ethers.id(crypto.randomUUID()); // bytes32 FK into Postgres

  const legs = planRebalanceLegs({
    vaultState: state,
    prices,
    targetWeightsBps: proposal.targetWeights as Record<string, number>,
  });

  if (legs.length === 0) {
    console.log(`[${vaultAddress}] AI proposal matches current allocation within tolerance, no swaps needed`);
    await recordRebalanceEvent({
      vaultAddress: state.address,
      reasoningId,
      txHash: null,
      outcome: "skipped_no_change",
      revertReason: null,
      proposal,
      executedAt: null,
      swaps: [],
    });
    return;
  }

  try {
    const instructions = await Promise.all(
      legs.map((leg) =>
        buildSwapInstruction(state, leg, prices, proposal.targetWeights as Record<string, number>)
      )
    );

    const receipt = await submitRebalance(state.address, instructions, reasoningId);

    await recordRebalanceEvent({
      vaultAddress: state.address,
      reasoningId,
      txHash: receipt.hash,
      outcome: "executed",
      revertReason: null,
      proposal,
      executedAt: new Date(),
      swaps: instructions.map((ix) => ({
        tokenIn: ix.tokenIn,
        tokenOut: ix.tokenOut,
        amountIn: ix.amountIn,
        amountOut: ix.expectedAmountOut, // refine post-tx via event logs if exact fill matters
      })),
    });

    console.log(`[${vaultAddress}] rebalance executed: ${receipt.hash}`);
  } catch (err: any) {
    console.error(`[${vaultAddress}] rebalance failed:`, err.message ?? err);
    await recordRebalanceEvent({
      vaultAddress: state.address,
      reasoningId,
      txHash: null,
      outcome: "reverted",
      revertReason: String(err.message ?? err).slice(0, 500),
      proposal,
      executedAt: null,
      swaps: [],
    });
  }
}

async function runCycle(): Promise<void> {
  console.log(`\n=== Rebalance cycle starting: ${new Date().toISOString()} ===`);
  const vaults = await listAllVaults();
  console.log(`Found ${vaults.length} vault(s)`);

  for (const vaultAddress of vaults) {
    try {
      await processVault(vaultAddress);
    } catch (err) {
      // One vault's failure should never block the others.
      console.error(`[${vaultAddress}] unexpected error, continuing to next vault:`, err);
    }
  }
}

console.log(`Steward executor starting. Cron: "${config.cron}"`);
cron.schedule(config.cron, () => {
  runCycle().catch((err) => console.error("Cycle failed:", err));
});

// Also run once immediately on startup rather than waiting for the first cron tick.
runCycle().catch((err) => console.error("Initial cycle failed:", err));
