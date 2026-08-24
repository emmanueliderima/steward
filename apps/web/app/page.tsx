"use client";

import { useCallback, useEffect, useState } from "react";
import type { DashboardSummary, RebalanceRecord } from "@steward/shared-types";
import { useWallet } from "@/lib/wallet";
import { api } from "@/lib/api";
import { formatUsd, formatRelativeTime } from "@/lib/format";
import { TopBar } from "@/components/Topbar";
import { StatPanel } from "@/components/StatPanel";
import { AssetAllocation } from "@/components/AssetAllocation";
import { RebalanceLedger } from "@/components/RebalanceLedger";
import { VaultOnboarding } from "@/components/VaultOnboarding";
import { FundVault } from "@/components/FundVault";

interface PublicConfig {
  vaultFactoryAddress: string;
  chainId: number;
  testnetFaucetEnabled: boolean;
}

export default function DashboardPage() {
  const { address, connect } = useWallet();
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [history, setHistory] = useState<RebalanceRecord[]>([]);
  const [publicConfig, setPublicConfig] = useState<PublicConfig | null>(null);
  const [newlyCreated, setNewlyCreated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const showLoadError = useCallback((context: string, err: unknown) => {
    console.error(`[Steward dashboard] ${context}:`, err);
    setError("We couldn't load your vault right now. Please check your connection and try again.");
  }, []);

  const loadVault = useCallback(async (vault: string) => {
    setVaultAddress(vault);
    const [summaryRes, historyRes] = await Promise.all([
      api.getSummary(vault),
      api.getHistory(vault),
    ]);
    setSummary(summaryRes);
    setHistory(historyRes.history);
  }, []);

  useEffect(() => {
    if (!address) {
      setVaultAddress(null);
      setSummary(null);
      setHistory([]);
      return;
    }

    setLoading(true);
    setError(null);
    setNewlyCreated(false);

    Promise.all([api.getConfig(), api.getVaultsByOwner(address)])
      .then(async ([config, { vaults }]) => {
        setPublicConfig(config);
        if (vaults.length === 0) {
          setVaultAddress(null);
          setSummary(null);
          setHistory([]);
          return;
        }
        await loadVault(vaults[0]);
      })
      .catch((err) => showLoadError("initial vault load failed", err))
      .finally(() => setLoading(false));
  }, [address, loadVault, showLoadError]);

  function handleVaultCreated(createdVault: string) {
    setNewlyCreated(true);
    setError(null);
    setLoading(true);
    loadVault(createdVault)
      .catch((err) => showLoadError("new vault summary load failed", err))
      .finally(() => setLoading(false));
  }

  function refreshVault() {
    if (!vaultAddress) return;
    loadVault(vaultAddress).catch((err) => showLoadError("vault refresh failed", err));
  }

  if (!address) {
    return (
      <div className="min-h-screen">
        <TopBar />
        <main className="flex flex-col items-center justify-center gap-4 px-6 py-32 text-center">
          <p className="max-w-sm text-sm text-text-lo">
            Connect your wallet to open an existing Steward vault or create your first one.
          </p>
          <button
            onClick={connect}
            className="rounded border border-hairline px-4 py-2 font-mono text-xs text-text-hi transition-colors hover:border-executed hover:text-executed"
          >
            CONNECT WALLET
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <TopBar vaultAddress={vaultAddress ?? undefined} />
      <main className="mx-auto max-w-4xl px-6 py-8">
        {loading && <div className="text-sm text-text-lo">Loading vault state…</div>}
        {error && (
          <div className="flex flex-wrap items-center justify-between gap-3 border border-reverted/30 bg-reverted/5 p-4 text-sm text-reverted">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="border border-reverted/40 px-3 py-1 font-mono text-[11px] hover:opacity-80"
            >
              TRY AGAIN
            </button>
          </div>
        )}

        {!loading && !error && !vaultAddress && publicConfig && (
          <VaultOnboarding
            factoryAddress={publicConfig.vaultFactoryAddress}
            chainId={publicConfig.chainId}
            onCreated={handleVaultCreated}
          />
        )}

        {summary && publicConfig && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatPanel label="TOTAL VALUE" value={formatUsd(summary.totalValueUsd)} />
              <StatPanel
                label="30D RETURN"
                value={summary.return30dPct === null ? "—" : `${summary.return30dPct.toFixed(1)}%`}
                tone={
                  summary.return30dPct === null
                    ? "neutral"
                    : summary.return30dPct >= 0
                      ? "executed"
                      : "reverted"
                }
                hint={summary.return30dPct === null ? "not enough history yet" : undefined}
              />
              <StatPanel
                label="NEXT TRIGGER"
                value={formatRelativeTime(summary.nextTriggerAt)}
                tone="pending"
                hint={`last rebalance ${formatRelativeTime(summary.lastRebalanceAt)}`}
              />
            </div>

            <div className="mt-4">
              <AssetAllocation assets={summary.assets} />
            </div>

            <div className="mt-4">
              <FundVault
                vaultAddress={summary.vaultAddress}
                assets={summary.assets}
                chainId={publicConfig.chainId}
                testnetFaucetEnabled={publicConfig.testnetFaucetEnabled}
                emphasized={newlyCreated || summary.totalValueUsd === 0}
                onFunded={refreshVault}
              />
            </div>

            <div className="mt-4">
              <RebalanceLedger history={history} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
