import { ethers } from "hardhat";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Set this to the real OKX DEX aggregator router address for the target
// network before deploying to testnet/mainnet. Check OKX's X Layer docs —
// router addresses can differ between testnet and mainnet.
const OKX_ROUTER_ADDRESS = process.env.OKX_ROUTER_ADDRESS ?? "";

// The backend/keeper wallet address that will be allowed to call
// executeRebalance on every vault created through the factory.
const EXECUTOR_ADDRESS = process.env.EXECUTOR_ADDRESS ?? "";

async function main() {
  if (!OKX_ROUTER_ADDRESS || !EXECUTOR_ADDRESS) {
    throw new Error(
      "Set OKX_ROUTER_ADDRESS and EXECUTOR_ADDRESS in your environment before deploying."
    );
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const deploymentBlock = await ethers.provider.getBlockNumber();
  const network = await ethers.provider.getNetwork();

  // Catches the exact footgun described in Vault.sol's comments: a low-level
  // .call() to an address with no code silently "succeeds" and does nothing,
  // rather than reverting — so a typo'd or wrong-network router address
  // wouldn't fail until someone tries to rebalance and gets a confusing
  // zero-balance-change result. Fail here, loudly, instead.
  const routerCode = await ethers.provider.getCode(OKX_ROUTER_ADDRESS);
  if (routerCode === "0x") {
    throw new Error(
      `OKX_ROUTER_ADDRESS (${OKX_ROUTER_ADDRESS}) has no contract code on this network. ` +
        `Double-check it's the correct OKX DEX router address for the network you're deploying to — ` +
        `testnet and mainnet router addresses can differ.`
    );
  }

  const Vault = await ethers.getContractFactory("Vault");
  const vaultImplementation = await Vault.deploy();
  await vaultImplementation.waitForDeployment();
  console.log("Vault implementation:", await vaultImplementation.getAddress());

  const VaultFactory = await ethers.getContractFactory("VaultFactory");
  const factory = await VaultFactory.deploy(
    await vaultImplementation.getAddress(),
    OKX_ROUTER_ADDRESS,
    EXECUTOR_ADDRESS
  );
  await factory.waitForDeployment();
  console.log("VaultFactory:", await factory.getAddress());

  const executorEnv = {
    VAULT_FACTORY_ADDRESS: await factory.getAddress(),
    OKX_USE_MOCK_ROUTER: "false",
  };
  const indexerEnv = {
    VAULT_FACTORY_ADDRESS: await factory.getAddress(),
    GENESIS_BLOCK: deploymentBlock,
  };
  const reference = {
    network: network.name,
    chainId: Number(network.chainId),
    deploymentBlock,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    executor: EXECUTOR_ADDRESS,
    okxRouter: OKX_ROUTER_ADDRESS,
    vaultImplementation: await vaultImplementation.getAddress(),
    vaultFactory: await factory.getAddress(),
  };

  const outDir = join(__dirname, "..", "deployments");
  mkdirSync(outDir, { recursive: true });
  // Timestamped filename, deliberately not fixed like the mock script's —
  // this is the "real" factory, and overwriting a past live deployment's
  // record on a later redeploy would be a genuinely bad way to lose an address.
  const outPath = join(outDir, `${network.name}-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify({ executorEnv, indexerEnv, reference }, null, 2));

  console.log(`\nDeployment record written to ${outPath}\n`);
  console.log("Paste into apps/executor/.env:");
  console.log(JSON.stringify(executorEnv, null, 2));
  console.log("\nPaste into apps/indexer/.env:");
  console.log(JSON.stringify(indexerEnv, null, 2));
  console.log("\nFull reference:");
  console.log(JSON.stringify(reference, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});