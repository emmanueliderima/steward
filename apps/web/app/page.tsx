"use client";

import { useEffect, useState } from "react";
import type { DashboardSummary, RebalanceRecord } from "@steward/shared-types";
import { useWallet } from "@/lib/wallet";
import { api } from "@/lib/api";
import { formatUsd, formatRelativeTime } from "@/lib/format";
import { TopBar } from "@/components/Topbar";
import { StatPanel } from "@/components/StatPanel";
import { AssetAllocation } from "@/components/AssetAllocation";
import { RebalanceLedger } from "@/components/RebalanceLedger";

export default function DashboardPage() {
  const { address, connect } = useWallet();
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [history, setHistory] = useState<RebalanceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    setError(null);

    api
      .getVaultsByOwner(address)
      .then(({ vaults }) => {
        if (vaults.length === 0) {
          setError("No vault found for this wallet yet.");
          return null;
        }
        setVaultAddress(vaults[0]);
        return Promise.all([api.getSummary(vaults[0]), api.getHistory(vaults[0])]);
      })
      .then((result) => {
        if (!result) return;
        const [summaryRes, historyRes] = result;
        setSummary(summaryRes);
        setHistory(historyRes.history);
      })
      .catch((err) => setError(err.message ?? String(err)))
      .finally(() => setLoading(false));
  }, [address]);

  if (!address) {
    return (
      <div className="min-h-screen">
        <TopBar />
        <main className="flex flex-col items-center justify-center gap-4 px-6 py-32 text-center">
          <p className="max-w-sm text-sm text-text-lo">
            Connect the wallet that owns your Steward vault to see its current state.
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
        {error && <div className="text-sm text-reverted">{error}</div>}

        {summary && (
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
              <RebalanceLedger history={history} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}