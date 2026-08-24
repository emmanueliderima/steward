import { ethers } from "hardhat";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface DeploymentRecord {
  reference: {
    chainId: number;
    mockRouter: string;
    tokens: Record<"mBTC" | "mETH" | "mRWA", string>;
  };
}

const TARGET_LIQUIDITY: Record<"mBTC" | "mETH" | "mRWA", string> = {
  mBTC: process.env.ROUTER_MBTC_LIQUIDITY ?? "100",
  mETH: process.env.ROUTER_METH_LIQUIDITY ?? "1000",
  mRWA: process.env.ROUTER_MRWA_LIQUIDITY ?? "100000",
};

async function waitForBalance(
  token: Awaited<ReturnType<typeof ethers.getContractAt>>,
  account: string,
  minimum: bigint,
  confirmedBlock: number
): Promise<bigint> {
  let lastBalance = 0n;

  // Public RPC endpoints can route the receipt and the following eth_call to
  // nodes at slightly different heights. Reading the confirmed block and
  // retrying avoids treating that propagation delay as a failed mint.
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      lastBalance = await token.balanceOf(account, { blockTag: confirmedBlock });
      if (lastBalance >= minimum) return lastBalance;
    } catch (error) {
      if (attempt === 8) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }

  return lastBalance;
}

async function main() {
  const deploymentPath = join(__dirname, "..", "deployments", "testnet-mock.json");
  const deployment = JSON.parse(readFileSync(deploymentPath, "utf8")) as DeploymentRecord;
  const { mockRouter, tokens, chainId } = deployment.reference;

  const network = await ethers.provider.getNetwork();
  if (network.chainId !== BigInt(chainId)) {
    throw new Error(`Wrong network: RPC is ${network.chainId}, deployment is on ${chainId}`);
  }

  const routerCode = await ethers.provider.getCode(mockRouter);
  if (routerCode === "0x") throw new Error(`No mock router bytecode at ${mockRouter}`);

  const [funder] = await ethers.getSigners();
  const gasBalance = await ethers.provider.getBalance(funder.address);
  console.log(`Funding mock router ${mockRouter}`);
  console.log(`Signer: ${funder.address}`);
  console.log(`Gas balance: ${ethers.formatEther(gasBalance)} OKB\n`);

  for (const symbol of ["mBTC", "mETH", "mRWA"] as const) {
    const tokenAddress = tokens[symbol];
    const token = await ethers.getContractAt("MockERC20", tokenAddress, funder);
    const [onChainSymbol, decimals, current] = await Promise.all([
      token.symbol(),
      token.decimals(),
      token.balanceOf(mockRouter),
    ]);
    if (onChainSymbol !== symbol) {
      throw new Error(`${tokenAddress} reports ${onChainSymbol}, expected ${symbol}`);
    }

    const target = ethers.parseUnits(TARGET_LIQUIDITY[symbol], decimals);
    if (current >= target) {
      console.log(`${symbol}: already funded (${ethers.formatUnits(current, decimals)}), skipping`);
      continue;
    }

    const deficit = target - current;
    console.log(`${symbol}: minting ${ethers.formatUnits(deficit, decimals)} to router...`);
    const tx = await token.mint(mockRouter, deficit);
    console.log(`  tx: ${tx.hash}`);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error(`${symbol} mint transaction reverted`);

    const updated = await waitForBalance(token, mockRouter, target, receipt.blockNumber);
    if (updated < target) throw new Error(`${symbol} router balance did not reach its target`);
    console.log(`  balance: ${ethers.formatUnits(updated, decimals)}`);
  }

  console.log("\nMock router liquidity targets are satisfied.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
