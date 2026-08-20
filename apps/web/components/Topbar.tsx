"use client";

import Link from "next/link";
import { useWallet } from "@/lib/wallet";
import { shortAddress } from "@/lib/format";

export function TopBar({ vaultAddress }: { vaultAddress?: string }) {
  const { address, connecting, connect } = useWallet();

  return (
    <header className="flex items-center justify-between border-b border-hairline px-6 py-4">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-sm font-medium tracking-widest text-text-hi">STEWARD</span>
        {vaultAddress && (
          <span className="font-mono text-xs text-text-lo">{shortAddress(vaultAddress)}</span>
        )}
      </div>
      <div className="flex items-center gap-4">
        {vaultAddress && (
          <Link
            href={`/settings?vault=${vaultAddress}`}
            className="font-mono text-xs text-text-lo transition-colors hover:text-text-hi"
          >
            SETTINGS
          </Link>
        )}
        <button
          onClick={connect}
          disabled={connecting}
          className="rounded border border-hairline px-3 py-1.5 font-mono text-xs text-text-hi transition-colors hover:border-executed hover:text-executed disabled:opacity-50"
        >
          {address ? shortAddress(address) : connecting ? "CONNECTING…" : "CONNECT"}
        </button>
      </div>
    </header>
  );
}