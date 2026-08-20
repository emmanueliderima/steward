import { ethers } from "ethers";
import { Vault__factory, IERC20Metadata__factory } from "@steward/contracts-sdk";
import { config } from "./config";

export const provider = new ethers.JsonRpcProvider(config.rpcUrl);

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