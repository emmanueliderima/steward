"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { RiskParams } from "@steward/shared-types";
import { useWallet } from "@/lib/wallet";
import { api } from "@/lib/api";
import { TopBar } from "@/components/Topbar";
import { RiskParamForm } from "@/components/RiskParamsForm";

export default function SettingsPage() {
  const { address, connect } = useWallet();
  const searchParams = useSearchParams();
  const vaultAddress = searchParams.get("vault");

  const [riskParams, setRiskParams] = useState<RiskParams | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!vaultAddress) return;
    setLoading(true);
    setError(null);
    api
      .getRiskParams(vaultAddress)
      .then(setRiskParams)
      .catch((err) => setError(err.message ?? String(err)))
      .finally(() => setLoading(false));
  }, [vaultAddress]);

  if (!address) {
    return (
      <div className="min-h-screen">
        <TopBar />
        <main className="flex flex-col items-center justify-center gap-4 px-6 py-32 text-center">
          <p className="max-w-sm text-sm text-text-lo">
            Connect the wallet that owns this vault to change its risk parameters.
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

  if (!vaultAddress) {
    return (
      <div className="min-h-screen">
        <TopBar />
        <main className="px-6 py-16 text-center text-sm text-text-lo">
          No vault specified. Go back to the dashboard and use the settings link there.
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <TopBar vaultAddress={vaultAddress} />
      <main className="mx-auto max-w-md px-6 py-8">
        <a href="/" className="font-mono text-xs text-text-lo transition-colors hover:text-text-hi">
          ← BACK TO DASHBOARD
        </a>
        <h1 className="mt-4 font-mono text-sm tracking-widest text-text-hi">RISK PARAMETERS</h1>

        {loading && <p className="mt-6 text-sm text-text-lo">Loading current parameters…</p>}
        {error && <p className="mt-6 text-sm text-reverted">{error}</p>}

        {riskParams && (
          <div className="mt-6 border border-hairline bg-surface p-5">
            <RiskParamForm vaultAddress={vaultAddress} initial={riskParams} />
          </div>
        )}

        <p className="mt-6 text-xs text-text-lo">
          Changes are submitted as a transaction signed by your own wallet — Steward's backend
          never touches this vault's funds or settings on your behalf.
        </p>
      </main>
    </div>
  );
}