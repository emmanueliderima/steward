"use client";

import { useEffect, useState } from "react";
import { formatUnits, parseUnits } from "ethers";
import type { AssetOverviewRow } from "@steward/shared-types";
import { IERC20Metadata__factory, Vault__factory } from "@steward/contracts-sdk";
import { useWallet } from "@/lib/wallet";

type Status =
  | "idle"
  | "checking"
  | "approval-signing"
  | "approval-confirming"
  | "deposit-signing"
  | "deposit-confirming"
  | "done"
  | "error";

export function FundVault({
  vaultAddress,
  assets,
  chainId,
  emphasized = false,
  onFunded,
}: {
  vaultAddress: string;
  assets: AssetOverviewRow[];
  chainId: number;
  emphasized?: boolean;
  onFunded: () => void;
}) {
  const { address, ensureExpectedChain, getSigner } = useWallet();
  const [selectedToken, setSelectedToken] = useState<string>(assets[0]?.address ?? "");
  const [amount, setAmount] = useState("");
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!assets.some((asset) => asset.address === selectedToken)) {
      setSelectedToken(assets[0]?.address ?? "");
    }
  }, [assets, selectedToken]);

  async function refreshBalance(tokenAddress = selectedToken) {
    if (!address || !tokenAddress) return;
    try {
      const signer = await getSigner();
      const token = IERC20Metadata__factory.connect(tokenAddress, signer);
      const [balance, decimals] = await Promise.all([token.balanceOf(address), token.decimals()]);
      setWalletBalance(formatUnits(balance, decimals));
    } catch {
      setWalletBalance(null);
    }
  }

  useEffect(() => {
    refreshBalance().catch(() => undefined);
    // getSigner is stable; selected token/account changes are the useful triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedToken, address]);

  async function handleDeposit() {
    if (!address || !selectedToken) return;
    setStatus("checking");
    setError(null);

    try {
      await ensureExpectedChain(chainId);
      const signer = await getSigner();
      const token = IERC20Metadata__factory.connect(selectedToken, signer);
      const vault = Vault__factory.connect(vaultAddress, signer);
      const decimals = Number(await token.decimals());
      const parsedAmount = parseUnits(amount, decimals);
      if (parsedAmount <= 0n) throw new Error("Enter an amount greater than zero.");

      const [balance, allowance] = await Promise.all([
        token.balanceOf(address),
        token.allowance(address, vaultAddress),
      ]);
      if (parsedAmount > balance) throw new Error("The deposit amount exceeds your wallet balance.");

      if (allowance < parsedAmount) {
        setStatus("approval-signing");
        const approval = await token.approve(vaultAddress, parsedAmount);
        setStatus("approval-confirming");
        await approval.wait();
      }

      setStatus("deposit-signing");
      const deposit = await vault.deposit(selectedToken, parsedAmount);
      setStatus("deposit-confirming");
      await deposit.wait();

      setAmount("");
      setStatus("done");
      await refreshBalance(selectedToken);
      onFunded();
    } catch (err: any) {
      setStatus("error");
      setError(err.shortMessage ?? err.reason ?? err.message ?? String(err));
    }
  }

  const buttonLabel: Record<Status, string> = {
    idle: "APPROVE & DEPOSIT",
    checking: "CHECKING BALANCE…",
    "approval-signing": "CONFIRM APPROVAL IN WALLET…",
    "approval-confirming": "CONFIRMING APPROVAL…",
    "deposit-signing": "CONFIRM DEPOSIT IN WALLET…",
    "deposit-confirming": "CONFIRMING DEPOSIT…",
    done: "DEPOSIT COMPLETE",
    error: "TRY AGAIN",
  };

  return (
    <section className={`border bg-surface p-5 ${emphasized ? "border-executed/50" : "border-hairline"}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] tracking-widest text-executed">
            {emphasized ? "VAULT CREATED · NEXT STEP" : "FUND VAULT"}
          </div>
          <p className="mt-1 text-sm text-text-lo">
            Approve an allowed token, then deposit it into your vault.
          </p>
        </div>
        {walletBalance !== null && (
          <span className="whitespace-nowrap font-mono text-[10px] text-text-lo">
            WALLET {Number(walletBalance).toLocaleString(undefined, { maximumFractionDigits: 6 })}
          </span>
        )}
      </div>

      {assets.length === 0 ? (
        <p className="mt-4 text-sm text-pending">Loading the vault's allowed assets…</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <select
            value={selectedToken}
            onChange={(event) => {
              setSelectedToken(event.target.value);
              setStatus("idle");
              setError(null);
            }}
            className="min-w-0 border border-hairline bg-surface-2 px-3 py-2 font-mono text-xs text-text-hi"
          >
            {assets.map((asset) => (
              <option key={asset.address} value={asset.address}>
                {asset.symbol} · {asset.address.slice(0, 6)}…{asset.address.slice(-4)}
              </option>
            ))}
          </select>
          <input
            aria-label="Deposit amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setStatus("idle");
              setError(null);
            }}
            placeholder="Amount"
            className="min-w-0 border border-hairline bg-surface-2 px-3 py-2 font-mono text-xs text-text-hi placeholder:text-text-lo/50"
          />
          <button
            onClick={handleDeposit}
            disabled={!amount || (status !== "idle" && status !== "error" && status !== "done")}
            className="border border-executed/40 bg-executed-dim px-4 py-2 font-mono text-[11px] text-executed hover:opacity-80 disabled:cursor-wait disabled:opacity-50"
          >
            {buttonLabel[status]}
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-xs text-reverted">{error}</p>}
      <p className="mt-3 text-[11px] text-text-lo">
        The first deposit of a token normally requires two wallet confirmations: approval and deposit.
      </p>
    </section>
  );
}
