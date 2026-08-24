import { ethers } from "hardhat";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Deploys a self-contained testnet fixture: three mock tokens, a mock OKX
// router, and a VaultFactory wired to that mock router instead of OKX's real
// one. Use this for Tier 3 integration testing — it lets the full
// cron -> AI -> submit -> on-chain-check loop run against a real deployed
// chain (real tx, real gas, real reverts) without depending on OKX indexing
// this testnet, which it almost certainly doesn't.
//
// Keep this fixture's VaultFactory separate from your "real" one (deployed
// via deploy.ts with OKX's actual router address) — don't reuse addresses
// between the two, or a mock-mode vault could end up pointed at a router
// with no code on it.

const EXECUTOR_ADDRESS = process.env.EXECUTOR_ADDRESS ?? "";

async function main() {
  if (!EXECUTOR_ADDRESS) {
    throw new Error("Set EXECUTOR_ADDRESS in your environment before deploying.");
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deploying mock testnet fixture with:", deployer.address);

  // Captured before any tx in this script — safe to use as GENESIS_BLOCK for
  // apps/indexer, since nothing this fixture creates could have emitted an
  // event before this block.
  const deploymentBlock = await ethers.provider.getBlockNumber();
  const network = await ethers.provider.getNetwork();

  console.log(`Deploying mock testnet fixture to ${network.name} (chainId ${network.chainId}) at block ${deploymentBlock}`);

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mBTC = await MockERC20.deploy("Mock BTC", "mBTC");
  await mBTC.waitForDeployment();
  const mETH = await MockERC20.deploy("Mock ETH", "mETH");
  await mETH.waitForDeployment();
  const mRWA = await MockERC20.deploy("Mock RWA", "mRWA");
  await mRWA.waitForDeployment();

  const MockOKXRouter = await ethers.getContractFactory("MockOKXRouter");
  const mockRouter = await MockOKXRouter.deploy();
  await mockRouter.waitForDeployment();

  const Vault = await ethers.getContractFactory("Vault");
  const vaultImplementation = await Vault.deploy();
  await vaultImplementation.waitForDeployment();

  const VaultFactory = await ethers.getContractFactory("VaultFactory");
  const factory = await VaultFactory.deploy(
    await vaultImplementation.getAddress(),
    await mockRouter.getAddress(), // <- mock router, deliberately not OKX's real one
    EXECUTOR_ADDRESS
  );
  await factory.waitForDeployment();

  // Create one test vault: 60% max BTC, 60% max ETH, 40% max RWA,
  // 2% max slippage, no more than one rebalance per hour.
  const allowedAssets = [await mBTC.getAddress(), await mETH.getAddress(), await mRWA.getAddress()];
  const maxAllocationBps = [6000, 6000, 4000];
  const tx = await factory.createVault(allowedAssets, maxAllocationBps, 200, 3600);
  const receipt = await tx.wait();
  const createdEvent = receipt!.logs
    .map((log: any) => {
      try {
        return factory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed: any) => parsed?.name === "VaultCreated");
  const vaultAddress = createdEvent!.args.vault as string;

  // Fund the deployer and deposit some BTC into the vault so there's
  // something for the executor to actually rebalance on the first cycle.
  await (await mBTC.mint(deployer.address, ethers.parseEther("10"))).wait();
  await (await mBTC.approve(vaultAddress, ethers.parseEther("10"))).wait();
  const vault = await ethers.getContractAt("Vault", vaultAddress);
  await (await vault.deposit(await mBTC.getAddress(), ethers.parseEther("10"))).wait();

  const executorEnv = {
    VAULT_FACTORY_ADDRESS: await factory.getAddress(),
    MOCK_ROUTER_ADDRESS: await mockRouter.getAddress(),
    OKX_USE_MOCK_ROUTER: "true",
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
    vaultImplementation: await vaultImplementation.getAddress(),
    vaultFactory: await factory.getAddress(),
    mockRouter: await mockRouter.getAddress(),
    testVaultAddress: vaultAddress,
    tokens: {
      mBTC: await mBTC.getAddress(),
      mETH: await mETH.getAddress(),
      mRWA: await mRWA.getAddress(),
    },
  };

  console.log("Deployment Reference:", JSON.stringify(reference, null, 2));

  const outDir = join(__dirname, "..", "deployments");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "testnet-mock.json");
  writeFileSync(outPath, JSON.stringify({ executorEnv, indexerEnv, reference }, null, 2));

  console.log(`\nDeployment record written to ${outPath}\n`);
  console.log("Paste into apps/executor/.env:");
  console.log(JSON.stringify(executorEnv, null, 2));
  console.log("\nPaste into apps/indexer/.env:");
  console.log(JSON.stringify(indexerEnv, null, 2));
  console.log("\nFull reference:");
  console.log(JSON.stringify(reference, null, 2));
}

console.log("Running deploy-testnet.ts script...");

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});