import { ethers } from "ethers";
import { config } from "./config";
import { Vault__factory, VaultFactory__factory, IERC20Metadata__factory } from "@steward/contracts-sdk";

const rpcRequest = new ethers.FetchRequest(config.chain.rpcUrl);
rpcRequest.timeout = 15_000;

export const provider = new ethers.JsonRpcProvider(rpcRequest, undefined, {
  staticNetwork: true,
  // dRPC's free plan rejects JSON-RPC batches containing more than three
  // requests. Concurrent vault reads must be sent independently.
  batchMaxCount: 1,
});
export const executorWallet = new ethers.Wallet(config.chain.executorPrivateKey, provider);

export function getFactory() {
  return VaultFactory__factory.connect(config.chain.vaultFactoryAddress, provider);
}

export function getVault(address: string) {
  // Connected to the executor wallet so it can also submit executeRebalance.
  return Vault__factory.connect(address, executorWallet);
}

export function getErc20(address: string) {
  return IERC20Metadata__factory.connect(address, provider);
}

export async function listAllVaults(): Promise<string[]> {
  const factory = getFactory();
  const total: bigint = await factory.totalVaults();
  const addresses: string[] = [];
  for (let i = 0n; i < total; i++) {
    addresses.push(await factory.allVaults(i));
  }
  return addresses;
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
  const vault = getVault(vaultAddress);

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
    const token = getErc20(asset);
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
  const vault = getVault(vaultAddress);
  const tx = await vault.executeRebalance(instructions, reasoningId);
  const receipt = await tx.wait();
  if (!receipt) throw new Error("executeRebalance transaction did not confirm");
  return receipt;
}
