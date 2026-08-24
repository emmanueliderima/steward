"use client";

import { useEffect, useState } from "react";
import { formatUnits, parseUnits } from "ethers";
import type { AssetOverviewRow } from "@steward/shared-types";
import {
  IERC20Metadata__factory,
  MockERC20__factory,
  Vault__factory,
} from "@steward/contracts-sdk";
import { useWallet } from "@/lib/wallet";
import { waitForConfirmation } from "@/lib/transactions";

type Status =
  | "idle"
  | "checking"
  | "approval-signing"
  | "approval-confirming"
  | "deposit-signing"
  | "deposit-confirming"
  | "done"
  | "error";

type FaucetStatus = "idle" | "minting" | "done" | "error";

const FAUCET_TARGET_BY_SYMBOL: Record<string, string> = {
  mBTC: "1",
  mETH: "10",
  mRWA: "1000",
};

export function FundVault({
  vaultAddress,
  assets,
  chainId,
  testnetFaucetEnabled,
  emphasized = false,
  onFunded,
}: {
  vaultAddress: string;
  assets: AssetOverviewRow[];
  chainId: number;
  testnetFaucetEnabled: boolean;
  emphasized?: boolean;
  onFunded: () => void;
}) {
  const { address, ensureExpectedChain, getSigner } = useWallet();
  const [selectedToken, setSelectedToken] = useState<string>(assets[0]?.address ?? "");
  const [amount, setAmount] = useState("");
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [faucetStatus, setFaucetStatus] = useState<FaucetStatus>("idle");
  const [faucetError, setFaucetError] = useState<string | null>(null);

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
        await waitForConfirmation(approval);
      }

      setStatus("deposit-signing");
      const deposit = await vault.deposit(selectedToken, parsedAmount);
      setStatus("deposit-confirming");
      await waitForConfirmation(deposit);

      setAmount("");
      setStatus("done");
      await refreshBalance(selectedToken);
      onFunded();
    } catch (err: any) {
      setStatus("error");
      setError(err.shortMessage ?? err.reason ?? err.message ?? String(err));
    }
  }

  async function handleGetTestnetTokens() {
    if (!address || !testnetFaucetEnabled) return;
    setFaucetStatus("minting");
    setFaucetError(null);

    try {
      await ensureExpectedChain(chainId);
      const signer = await getSigner();

      for (const asset of assets) {
        const targetText = FAUCET_TARGET_BY_SYMBOL[asset.symbol];
        if (!targetText) continue;

        const token = MockERC20__factory.connect(asset.address, signer);
        const decimals = Number(await token.decimals());
        const [current, target] = [
          await token.balanceOf(address),
          parseUnits(targetText, decimals),
        ];
        if (current >= target) continue;

        const mint = await token.mint(address, target - current);
        await waitForConfirmation(mint);
      }

      setFaucetStatus("done");
      await refreshBalance();
    } catch (err: any) {
      setFaucetStatus("error");
      setFaucetError(err.shortMessage ?? err.reason ?? err.message ?? String(err));
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

      {testnetFaucetEnabled && (
        <div className="mt-4 border border-pending/30 bg-pending/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] text-pending">TESTNET FAUCET</p>
              <p className="mt-1 text-[11px] text-text-lo">
                Tops your wallet up to 1 mBTC, 10 mETH, and 1,000 mRWA. You still need testnet OKB for gas.
              </p>
            </div>
            <button
              type="button"
              onClick={handleGetTestnetTokens}
              disabled={faucetStatus === "minting" || assets.length === 0}
              className="border border-pending/40 px-4 py-2 font-mono text-[11px] text-pending hover:opacity-80 disabled:cursor-wait disabled:opacity-50"
            >
              {faucetStatus === "minting"
                ? "CONFIRM MINTS IN WALLET…"
                : faucetStatus === "done"
                  ? "TOKENS READY"
                  : "GET TESTNET TOKENS"}
            </button>
          </div>
          {faucetError && <p className="mt-2 text-xs text-reverted">{faucetError}</p>}
        </div>
      )}

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
