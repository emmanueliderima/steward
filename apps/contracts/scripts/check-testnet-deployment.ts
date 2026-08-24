import { ethers } from "hardhat";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface DeploymentRecord {
  executorEnv: { VAULT_FACTORY_ADDRESS: string; MOCK_ROUTER_ADDRESS: string };
  indexerEnv: { VAULT_FACTORY_ADDRESS: string; GENESIS_BLOCK: number };
  reference: {
    chainId: number;
    deploymentBlock: number;
    deployedAt: string;
    deployer: string;
    executor: string;
    vaultImplementation: string;
    vaultFactory: string;
    mockRouter: string;
    testVaultAddress: string;
    tokens: Record<string, string>;
  };
}

let checks = 0;
let failures = 0;

function pass(label: string, detail = "") {
  checks++;
  console.log(`  PASS  ${label}${detail ? ` (${detail})` : ""}`);
}

function fail(label: string, detail: string) {
  checks++;
  failures++;
  console.error(`  FAIL  ${label} (${detail})`);
}

function check(label: string, condition: boolean, detail: string) {
  condition ? pass(label, detail) : fail(label, detail);
}

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

async function attempt(label: string, action: () => Promise<string | void>) {
  try {
    pass(label, await action());
  } catch (error: any) {
    fail(label, error.shortMessage ?? error.message ?? String(error));
  }
}

async function main() {
  const deploymentPath = join(__dirname, "..", "deployments", "testnet-mock.json");
  const deployment = JSON.parse(readFileSync(deploymentPath, "utf8")) as DeploymentRecord;
  const ref = deployment.reference;

  console.log(`\nSteward testnet deployment check`);
  console.log(`Record: ${deploymentPath}`);
  console.log(`Deployed: ${ref.deployedAt}\n`);

  const network = await ethers.provider.getNetwork();
  const latestBlock = await ethers.provider.getBlockNumber();
  console.log("Network and application configuration");
  check("RPC chain ID", network.chainId === BigInt(ref.chainId), `${network.chainId}`);
  check("deployment block is available", latestBlock >= ref.deploymentBlock, `${latestBlock}`);
  check(
    "VAULT_FACTORY_ADDRESS",
    Boolean(process.env.VAULT_FACTORY_ADDRESS && sameAddress(process.env.VAULT_FACTORY_ADDRESS, ref.vaultFactory)),
    process.env.VAULT_FACTORY_ADDRESS ?? "missing"
  );
  check("XLAYER_CHAIN_ID", process.env.XLAYER_CHAIN_ID === String(ref.chainId), process.env.XLAYER_CHAIN_ID ?? "missing");
  check(
    "executor factory record",
    sameAddress(deployment.executorEnv.VAULT_FACTORY_ADDRESS, ref.vaultFactory),
    deployment.executorEnv.VAULT_FACTORY_ADDRESS
  );
  check(
    "indexer factory record",
    sameAddress(deployment.indexerEnv.VAULT_FACTORY_ADDRESS, ref.vaultFactory),
    deployment.indexerEnv.VAULT_FACTORY_ADDRESS
  );

  const addresses: [string, string][] = [
    ["Vault implementation", ref.vaultImplementation],
    ["Vault factory", ref.vaultFactory],
    ["Mock router", ref.mockRouter],
    ["Test vault", ref.testVaultAddress],
    ...Object.entries(ref.tokens).map(([symbol, address]) => [`Token ${symbol}`, address] as [string, string]),
  ];
  const deployed = new Set<string>();

  console.log("\nDeployed bytecode");
  for (const [label, address] of addresses) {
    await attempt(label, async () => {
      if (!ethers.isAddress(address)) throw new Error(`invalid address ${address}`);
      const code = await ethers.provider.getCode(address);
      if (code === "0x") throw new Error(`no code at ${address}`);
      deployed.add(address.toLowerCase());
      return `${address}, ${(code.length - 2) / 2} bytes`;
    });
  }

  console.log("\nFactory wiring");
  if (deployed.has(ref.vaultFactory.toLowerCase())) {
    const factory = await ethers.getContractAt("VaultFactory", ref.vaultFactory);
    const [implementation, router, executor, total, ownerVaults] = await Promise.all([
      factory.vaultImplementation(), factory.okxRouter(), factory.defaultExecutor(),
      factory.totalVaults(), factory.getVaultsByOwner(ref.deployer),
    ]);
    check("implementation address", sameAddress(implementation, ref.vaultImplementation), implementation);
    check("router address", sameAddress(router, ref.mockRouter), router);
    check("executor address", sameAddress(executor, ref.executor), executor);
    check("factory has vaults", total > 0n, total.toString());
    check("owner lookup includes test vault", ownerVaults.some((a) => sameAddress(a, ref.testVaultAddress)), ownerVaults.join(", "));
    if (total > 0n) await attempt("allVaults getter", async () => factory.allVaults(0));
  } else fail("factory calls", "factory bytecode missing");

  console.log("\nVault state");
  if (deployed.has(ref.testVaultAddress.toLowerCase())) {
    const vault = await ethers.getContractAt("Vault", ref.testVaultAddress);
    const [owner, executor, router, assets, slippage, interval, lastRebalance] = await Promise.all([
      vault.owner(), vault.executor(), vault.okxRouter(), vault.getAllowedAssets(),
      vault.maxSlippageBps(), vault.minRebalanceInterval(), vault.lastRebalanceTimestamp(),
    ]);
    check("vault owner", sameAddress(owner, ref.deployer), owner);
    check("vault executor", sameAddress(executor, ref.executor), executor);
    check("vault router", sameAddress(router, ref.mockRouter), router);
    check("allowed asset count", assets.length === Object.keys(ref.tokens).length, `${assets.length}`);
    for (const [symbol, address] of Object.entries(ref.tokens)) {
      check(`vault allows ${symbol}`, assets.some((asset) => sameAddress(asset, address)), address);
      await attempt(`${symbol} allocation cap`, async () => `${await vault.maxAllocationBps(address)} bps`);
    }
    pass("risk parameters", `${slippage} bps, ${interval}s`);
    pass("last rebalance timestamp", lastRebalance.toString());
  } else fail("vault calls", "vault bytecode missing");

  console.log("\nToken contracts");
  for (const [recordedSymbol, address] of Object.entries(ref.tokens)) {
    if (!deployed.has(address.toLowerCase())) continue;
    await attempt(`${recordedSymbol} metadata and balances`, async () => {
      const token = await ethers.getContractAt("MockERC20", address);
      const [name, symbol, decimals, supply, owner, vault, router] = await Promise.all([
        token.name(), token.symbol(), token.decimals(), token.totalSupply(),
        token.balanceOf(ref.deployer), token.balanceOf(ref.testVaultAddress), token.balanceOf(ref.mockRouter),
      ]);
      if (symbol !== recordedSymbol) throw new Error(`on-chain symbol ${symbol}`);
      const format = (value: bigint) => ethers.formatUnits(value, decimals);
      return `${name}; supply ${format(supply)}; owner ${format(owner)}; vault ${format(vault)}; router ${format(router)}`;
    });
  }

  console.log("\nMock router ABI");
  if (deployed.has(ref.mockRouter.toLowerCase()) && Object.keys(ref.tokens).length >= 2) {
    await attempt("zero-amount swap simulation", async () => {
      const tokens = Object.values(ref.tokens);
      const router = await ethers.getContractAt("MockOKXRouter", ref.mockRouter);
      await router.swap.staticCall(tokens[0], 0n, tokens[1], 0n, { from: ref.deployer });
      return "eth_call only; no transaction sent";
    });
  } else fail("router simulation", "router bytecode or token addresses missing");

  console.log(`\nResult: ${checks - failures}/${checks} checks passed.`);
  if (failures) throw new Error(`${failures} deployment check(s) failed`);
}

main().catch((error) => {
  console.error("\nDeployment verification failed:");
  console.error(error);
  process.exitCode = 1;
});
