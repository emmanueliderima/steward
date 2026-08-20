"use client";

import { useState } from "react";
import { getAddress, isAddress } from "ethers";
import { IERC20Metadata__factory, VaultFactory__factory } from "@steward/contracts-sdk";
import { useWallet } from "@/lib/wallet";

interface AssetInput {
  id: number;
  address: string;
  maxAllocationPercent: number;
}

type Status = "idle" | "validating" | "signing" | "confirming" | "done" | "error";

export function VaultOnboarding({
  factoryAddress,
  chainId,
  onCreated,
}: {
  factoryAddress: string;
  chainId: number;
  onCreated: (vaultAddress: string) => void;
}) {
  const { address, ensureExpectedChain, getSigner } = useWallet();
  const [assets, setAssets] = useState<AssetInput[]>([
    { id: 1, address: "", maxAllocationPercent: 50 },
    { id: 2, address: "", maxAllocationPercent: 50 },
  ]);
  const [maxSlippagePercent, setMaxSlippagePercent] = useState(1);
  const [minRebalanceInterval, setMinRebalanceInterval] = useState(86400);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  function updateAsset(id: number, patch: Partial<AssetInput>) {
    setAssets((current) => current.map((asset) => (asset.id === id ? { ...asset, ...patch } : asset)));
  }

  async function handleCreate() {
    if (!address) return;
    setStatus("validating");
    setError(null);

    try {
      if (assets.length < 2) throw new Error("Add at least two assets to create a rebalancing vault.");
      if (assets.some((asset) => !isAddress(asset.address))) {
        throw new Error("Every asset must have a valid EVM token address.");
      }

      const normalized = assets.map((asset) => getAddress(asset.address));
      if (new Set(normalized.map((value) => value.toLowerCase())).size !== normalized.length) {
        throw new Error("Each token can only be added once.");
      }

      const caps = assets.map((asset) => Math.round(asset.maxAllocationPercent * 100));
      if (caps.some((cap) => cap < 0 || cap > 10000)) {
        throw new Error("Allocation limits must be between 0% and 100%.");
      }
      if (caps.reduce((sum, cap) => sum + cap, 0) < 10000) {
        throw new Error("Allocation limits must add up to at least 100% so a valid portfolio is possible.");
      }

      const slippageBps = Math.round(maxSlippagePercent * 100);
      if (slippageBps < 10 || slippageBps > 500) {
        throw new Error("Maximum slippage must be between 0.1% and 5%.");
      }

      await ensureExpectedChain(chainId);
      const signer = await getSigner();

      // Validate that every address is an ERC-20 contract before asking the
      // user to pay gas for vault creation.
      await Promise.all(
        normalized.map(async (tokenAddress) => {
          try {
            await IERC20Metadata__factory.connect(tokenAddress, signer).symbol();
          } catch {
            throw new Error(`${tokenAddress} does not appear to be an ERC-20 token on this network.`);
          }
        })
      );

      setStatus("signing");
      const factory = VaultFactory__factory.connect(factoryAddress, signer);
      const tx = await factory.createVault(normalized, caps, slippageBps, minRebalanceInterval);
      setStatus("confirming");
      await tx.wait();

      const ownedVaults = await factory.getVaultsByOwner(address);
      const createdVault = ownedVaults.at(-1);
      if (!createdVault) throw new Error("The transaction confirmed, but the new vault could not be found.");

      setStatus("done");
      onCreated(createdVault);
    } catch (err: any) {
      setStatus("error");
      setError(err.shortMessage ?? err.reason ?? err.message ?? String(err));
    }
  }

  return (
    <section className="mx-auto max-w-2xl border border-hairline bg-surface p-6">
      <div className="font-mono text-[11px] tracking-widest text-executed">NEW VAULT</div>
      <h1 className="mt-2 text-xl font-medium text-text-hi">Set your portfolio guardrails</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-text-lo">
        Choose the tokens Steward may hold and the limits its executor must obey. These settings
        are stored in your own vault contract and can only be changed by your wallet.
      </p>

      <div className="mt-6 flex flex-col gap-3">
        <div className="grid grid-cols-[1fr_110px_32px] gap-3 font-mono text-[10px] tracking-widest text-text-lo">
          <span>TOKEN CONTRACT</span>
          <span>MAX WEIGHT</span>
          <span />
        </div>
        {assets.map((asset) => (
          <div key={asset.id} className="grid grid-cols-[1fr_110px_32px] gap-3">
            <input
              aria-label="Token contract address"
              value={asset.address}
              onChange={(event) => updateAsset(asset.id, { address: event.target.value.trim() })}
              placeholder="0x..."
              className="min-w-0 border border-hairline bg-surface-2 px-3 py-2 font-mono text-xs text-text-hi placeholder:text-text-lo/50"
            />
            <div className="flex items-center border border-hairline bg-surface-2 px-3">
              <input
                aria-label="Maximum allocation percentage"
                type="number"
                min={0}
                max={100}
                step={1}
                value={asset.maxAllocationPercent}
                onChange={(event) =>
                  updateAsset(asset.id, { maxAllocationPercent: Number(event.target.value) })
                }
                className="w-full bg-transparent font-mono text-xs text-text-hi outline-none"
              />
              <span className="font-mono text-xs text-text-lo">%</span>
            </div>
            <button
              type="button"
              aria-label="Remove asset"
              disabled={assets.length <= 2}
              onClick={() => setAssets((current) => current.filter((item) => item.id !== asset.id))}
              className="border border-hairline text-text-lo hover:border-reverted hover:text-reverted disabled:cursor-not-allowed disabled:opacity-30"
            >
              −
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setAssets((current) => [
              ...current,
              { id: Math.max(...current.map((asset) => asset.id)) + 1, address: "", maxAllocationPercent: 0 },
            ])
          }
          className="self-start font-mono text-[11px] text-text-lo hover:text-executed"
        >
          + ADD ASSET
        </button>
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <label>
          <span className="font-mono text-[10px] tracking-widest text-text-lo">MAX SLIPPAGE</span>
          <div className="mt-2 flex items-center border border-hairline bg-surface-2 px-3">
            <input
              type="number"
              min={0.1}
              max={5}
              step={0.1}
              value={maxSlippagePercent}
              onChange={(event) => setMaxSlippagePercent(Number(event.target.value))}
              className="w-full bg-transparent py-2 font-mono text-xs text-text-hi outline-none"
            />
            <span className="font-mono text-xs text-text-lo">%</span>
          </div>
        </label>
        <label>
          <span className="font-mono text-[10px] tracking-widest text-text-lo">REBALANCE FREQUENCY</span>
          <select
            value={minRebalanceInterval}
            onChange={(event) => setMinRebalanceInterval(Number(event.target.value))}
            className="mt-2 w-full border border-hairline bg-surface-2 px-3 py-2 font-mono text-xs text-text-hi"
          >
            <option value={3600}>At most every hour</option>
            <option value={21600}>At most every 6 hours</option>
            <option value={86400}>At most every 24 hours</option>
            <option value={604800}>At most every 7 days</option>
          </select>
        </label>
      </div>

      <button
        onClick={handleCreate}
        disabled={status !== "idle" && status !== "error"}
        className="mt-7 w-full border border-executed/40 bg-executed-dim px-4 py-3 font-mono text-xs text-executed transition-opacity hover:opacity-80 disabled:cursor-wait disabled:opacity-50"
      >
        {status === "validating" && "VALIDATING ASSETS…"}
        {status === "signing" && "CONFIRM CREATION IN WALLET…"}
        {status === "confirming" && "CREATING VAULT ON-CHAIN…"}
        {status === "done" && "VAULT CREATED"}
        {(status === "idle" || status === "error") && "CREATE MY VAULT"}
      </button>

      {error && <p className="mt-3 text-sm text-reverted">{error}</p>}
      <p className="mt-4 text-xs leading-relaxed text-text-lo">
        Creating a vault requires one transaction and a small amount of OKB for gas. Steward cannot
        withdraw your assets or change these limits.
      </p>
    </section>
  );
}
