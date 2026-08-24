import { ethers } from "ethers";
import {
  Vault__factory,
  VaultFactory__factory,
  IERC20Metadata__factory,
} from "@steward/contracts-sdk";
import { config } from "./config";

const providers = config.rpcUrls.map((url) => {
  const request = new ethers.FetchRequest(url);
  request.timeout = 15_000;
  return new ethers.JsonRpcProvider(request, config.chainId, {
    staticNetwork: true,
    // Some public RPC gateways are unreliable with JSON-RPC batch payloads.
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
        `X Layer RPC attempt ${attempt}/${attempts} failed via ${config.rpcUrls[providerIndex]}:`,
        error
      );
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 400));
      }
    }
  }

  throw lastError;
}

export async function getVaultsByOwner(ownerAddress: string): Promise<string[]> {
  return withRpcRetry((provider) =>
    VaultFactory__factory.connect(config.vaultFactoryAddress, provider).getVaultsByOwner(
      ownerAddress
    )
  );
}

export interface LiveVaultState {
  address: string;
  owner: string;
  allowedAssets: string[];
  balances: Record<string, bigint>;
  decimals: Record<string, number>;
  symbols: Record<string, string>;
  minRebalanceIntervalSeconds: number;
}

export async function readLiveVaultState(vaultAddress: string): Promise<LiveVaultState> {
  return withRpcRetry((provider) => readLiveVaultStateOnce(vaultAddress, provider));
}

async function readLiveVaultStateOnce(
  vaultAddress: string,
  provider: ethers.JsonRpcProvider
): Promise<LiveVaultState> {
  const vault = Vault__factory.connect(vaultAddress, provider);

  const [owner, allowedAssets, minRebalanceInterval] = await Promise.all([
    vault.owner(),
    vault.getAllowedAssets(),
    vault.minRebalanceInterval(),
  ]);

  const balances: Record<string, bigint> = {};
  const decimals: Record<string, number> = {};
  const symbols: Record<string, string> = {};

  await Promise.all(
    allowedAssets.map(async (asset) => {
      const token = IERC20Metadata__factory.connect(asset, provider);
      const [balance, dec, sym] = await Promise.all([
        token.balanceOf(vaultAddress),
        token.decimals(),
        token.symbol(),
      ]);
      balances[asset] = balance;
      decimals[asset] = Number(dec);
      symbols[asset] = sym;
    })
  );

  return {
    address: vaultAddress,
    owner,
    allowedAssets,
    balances,
    decimals,
    symbols,
    minRebalanceIntervalSeconds: Number(minRebalanceInterval),
  };
}
