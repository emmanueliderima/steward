import { config } from "./config";
import { provider, syncFactory, syncVault } from "./event-sync";
import { listKnownVaults } from "./db";

async function runCycle(): Promise<void> {
  const latestBlock = await provider.getBlockNumber();

  await syncFactory(latestBlock);

  const vaults = await listKnownVaults();
  for (const vaultAddress of vaults) {
    try {
      await syncVault(vaultAddress, latestBlock);
    } catch (err) {
      // One vault's scan failing (e.g. a transient RPC error) shouldn't stop
      // the rest, and shouldn't advance that vault's checkpoint — it'll just
      // retry the same range next cycle.
      console.error(`[vault ${vaultAddress}] sync failed, will retry next cycle:`, err);
    }
  }
}

console.log(`Steward indexer starting. Polling every ${config.pollIntervalMs}ms.`);

async function loop(): Promise<void> {
  try {
    await runCycle();
  } catch (err) {
    console.error("Indexer cycle failed:", err);
  } finally {
    setTimeout(loop, config.pollIntervalMs);
  }
}

loop();