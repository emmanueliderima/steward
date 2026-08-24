import { ethers } from "ethers";
import { config } from "./config";
import { Vault__factory, VaultFactory__factory, IERC20Metadata__factory } from "@steward/contracts-sdk";

const providers = config.chain.rpcUrls.map((url) => {
  const request = new ethers.FetchRequest(url);
  request.timeout = 15_000;
  return new ethers.JsonRpcProvider(request, config.chain.chainId, {
    staticNetwork: true,
    // Public RPC gateways may reject or mishandle JSON-RPC batches.
    batchMaxCount: 1,
  });
});

async function withRpcRetry<T>(
  operation: (provider: ethers.JsonRpcProvider) => Promise<T>,
  attempts = Math.max(3, providers.length)
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const providerIndex = (attempt - 1) % providers.length;
    const provider = providers[providerIndex]!;
    try {
      return await operation(provider);
    } catch (error) {
      lastError = error;
      console.warn(
        `X Layer RPC attempt ${attempt}/${attempts} failed via ${config.chain.rpcUrls[providerIndex]}:`,
        error
      );
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 400));
      }
    }
  }

  throw lastError;
}

async function getHealthyProvider(): Promise<ethers.JsonRpcProvider> {
  return withRpcRetry(async (provider) => {
    await provider.getBlockNumber();
    return provider;
  });
}

export async function listAllVaults(): Promise<string[]> {
  return withRpcRetry(async (provider) => {
    const factory = VaultFactory__factory.connect(config.chain.vaultFactoryAddress, provider);
    const total: bigint = await factory.totalVaults();
    const addresses: string[] = [];
    for (let i = 0n; i < total; i++) {
      addresses.push(await factory.allVaults(i));
    }
    return addresses;
  });
}

export interface VaultState {
  address: string;
  owner: string;
  okxRouter: string;
  allowedAssets: string[];
  maxAllocationBps: Record<string, number>;
  maxSlippageBps: number;
  minRebalanceInterval: number;
  lastRebalanceTimestamp: number;
  balances: Record<string, bigint>; // token address -> raw balance
  decimals: Record<string, number>;
  symbols: Record<string, string>;
}

export async function readVaultState(vaultAddress: string): Promise<VaultState> {
  return withRpcRetry((provider) => readVaultStateOnce(vaultAddress, provider));
}

async function readVaultStateOnce(
  vaultAddress: string,
  provider: ethers.JsonRpcProvider
): Promise<VaultState> {
  const vault = Vault__factory.connect(vaultAddress, provider);

  const [owner, okxRouter, allowedAssets, maxSlippageBps, minRebalanceInterval, lastRebalanceTimestamp] =
    await Promise.all([
      vault.owner(),
      vault.okxRouter(),
      vault.getAllowedAssets(),
      vault.maxSlippageBps(),
      vault.minRebalanceInterval(),
      vault.lastRebalanceTimestamp(),
    ]);

  const maxAllocationBps: Record<string, number> = {};
  const balances: Record<string, bigint> = {};
  const decimals: Record<string, number> = {};
  const symbols: Record<string, string> = {};

  for (const asset of allowedAssets as string[]) {
    const token = IERC20Metadata__factory.connect(asset, provider);
    const [cap, balance, dec, sym] = await Promise.all([
      vault.maxAllocationBps(asset),
      token.balanceOf(vaultAddress),
      token.decimals(),
      token.symbol(),
    ]);
    maxAllocationBps[asset] = Number(cap);
    balances[asset] = balance;
    decimals[asset] = Number(dec);
    symbols[asset] = sym;
  }

  return {
    address: vaultAddress,
    owner,
    okxRouter,
    allowedAssets,
    maxAllocationBps,
    maxSlippageBps: Number(maxSlippageBps),
    minRebalanceInterval: Number(minRebalanceInterval),
    lastRebalanceTimestamp: Number(lastRebalanceTimestamp),
    balances,
    decimals,
    symbols,
  };
}

export function isDueForRebalance(state: VaultState): boolean {
  const nextAllowedAt = state.lastRebalanceTimestamp + state.minRebalanceInterval;
  return Math.floor(Date.now() / 1000) >= nextAllowedAt;
}

export interface SwapInstructionInput {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  expectedAmountOut: bigint;
  minAmountOut: bigint;
  targetAllocationBps: number;
  swapCalldata: string;
}

/**
 * Submits the AI's proposed rebalance to the vault. If any instruction
 * violates the owner's on-chain risk params, the whole transaction reverts —
 * that's the point. Caller should catch the revert and log it, not retry blindly.
 */
export async function submitRebalance(
  vaultAddress: string,
  instructions: SwapInstructionInput[],
  reasoningId: string // 0x-prefixed bytes32
): Promise<ethers.ContractTransactionReceipt> {
  // Select a responsive endpoint before signing. Do not retry sendTransaction:
  // a timeout after broadcast is ambiguous and resending could duplicate work.
  const provider = await getHealthyProvider();
  const executorWallet = new ethers.Wallet(config.chain.executorPrivateKey, provider);
  const vault = Vault__factory.connect(vaultAddress, executorWallet);
  const tx = await vault.executeRebalance(instructions, reasoningId);
  const receipt = await tx.wait();
  if (!receipt) throw new Error("executeRebalance transaction did not confirm");
  return receipt;
}
