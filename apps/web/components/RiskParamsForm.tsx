"use client";

import { useState } from "react";
import type { RiskParams } from "@steward/shared-types";
import { Vault__factory } from "@steward/contracts-sdk";
import { useWallet } from "@/lib/wallet";
import { formatBpsAsPercent } from "@/lib/format";

export function RiskParamForm({
  vaultAddress,
  initial,
}: {
  vaultAddress: string;
  initial: RiskParams;
}) {
  const { getSigner } = useWallet();
  const [maxAllocation, setMaxAllocation] = useState(initial.maxAllocationBps);
  const [maxSlippageBps, setMaxSlippageBps] = useState(initial.maxSlippageBps);
  const [minRebalanceIntervalSeconds, setMinRebalanceIntervalSeconds] = useState(
    initial.minRebalanceIntervalSeconds
  );
  const [status, setStatus] = useState<"idle" | "signing" | "confirming" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSave() {
    setStatus("signing");
    setErrorMessage(null);
    try {
      const signer = await getSigner();
      const vault = Vault__factory.connect(vaultAddress, signer);

      // Order must match initial.allowedAssets exactly — the contract takes
      // a bare array, not a map, so this is the one place ordering matters.
      const newMaxAllocationBps = initial.allowedAssets.map((asset) => maxAllocation[asset]);

      const tx = await vault.updateRiskParams(
        newMaxAllocationBps,
        maxSlippageBps,
        minRebalanceIntervalSeconds
      );
      setStatus("confirming");
      await tx.wait();
      setStatus("done");
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err.shortMessage ?? err.message ?? String(err));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="font-mono text-[11px] tracking-widest text-text-lo">
          MAX ALLOCATION PER ASSET
        </div>
        <div className="mt-3 flex flex-col gap-4">
          {initial.allowedAssets.map((asset) => (
            <div key={asset}>
              <div className="flex justify-between font-mono text-xs text-text-hi">
                <span>{asset.slice(0, 6)}…{asset.slice(-4)}</span>
                <span>{formatBpsAsPercent(maxAllocation[asset] ?? 0)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={10000}
                step={100}
                value={maxAllocation[asset] ?? 0}
                onChange={(e) =>
                  setMaxAllocation((prev) => ({ ...prev, [asset]: Number(e.target.value) }))
                }
                className="mt-1.5 w-full accent-executed"
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex justify-between font-mono text-[11px] tracking-widest text-text-lo">
          <span>MAX SLIPPAGE TOLERANCE</span>
          <span className="text-text-hi">{formatBpsAsPercent(maxSlippageBps)}</span>
        </div>
        <input
          type="range"
          min={10}
          max={500}
          step={10}
          value={maxSlippageBps}
          onChange={(e) => setMaxSlippageBps(Number(e.target.value))}
          className="mt-1.5 w-full accent-executed"
        />
      </div>

      <div>
        <div className="font-mono text-[11px] tracking-widest text-text-lo">
          MINIMUM TIME BETWEEN REBALANCES
        </div>
        <select
          value={minRebalanceIntervalSeconds}
          onChange={(e) => setMinRebalanceIntervalSeconds(Number(e.target.value))}
          className="mt-2 w-full border border-hairline bg-surface-2 px-3 py-2 font-mono text-xs text-text-hi"
        >
          <option value={3600}>1 hour</option>
          <option value={21600}>6 hours</option>
          <option value={86400}>24 hours</option>
          <option value={604800}>7 days</option>
        </select>
      </div>

      <button
        onClick={handleSave}
        disabled={status === "signing" || status === "confirming"}
        className="border border-executed/40 bg-executed-dim px-4 py-2.5 font-mono text-xs text-executed transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        {status === "signing" && "CONFIRM IN WALLET…"}
        {status === "confirming" && "CONFIRMING ON-CHAIN…"}
        {status === "done" && "SAVED"}
        {(status === "idle" || status === "error") && "SAVE CHANGES"}
      </button>

      {status === "error" && (
        <p className="text-xs text-reverted">{errorMessage}</p>
      )}
      {status === "done" && (
        <p className="text-xs text-text-lo">
          Change confirmed on-chain. The indexer will pick it up on its next poll.
        </p>
      )}
    </div>
  );
}