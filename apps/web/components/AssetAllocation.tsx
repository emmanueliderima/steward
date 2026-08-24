import type { AssetOverviewRow } from "@steward/shared-types";
import { formatUsd, formatBpsAsPercent, shortAddress } from "@/lib/format";

const tones = [
  { bar: "bg-executed", text: "text-executed" },
  { bar: "bg-ai", text: "text-ai" },
  { bar: "bg-pending", text: "text-pending" },
];

export function AssetAllocation({ assets }: { assets: AssetOverviewRow[] }) {
  return (
    <div className="border border-hairline bg-surface p-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] tracking-widest text-text-lo">
            ASSET ALLOCATION
          </div>
          <p className="mt-1 text-sm text-text-lo">Current vault composition by market value.</p>
        </div>
        <span className="font-mono text-[10px] text-text-lo">{assets.length} ASSETS</span>
      </div>

      {assets.length === 0 ? (
        <p className="mt-5 text-sm text-text-lo">No allowed assets found for this vault.</p>
      ) : (
        <div className="mt-5 space-y-5">
          {assets.map((asset, index) => {
            const tone = tones[index % tones.length]!;
            const width = Math.min(Math.max(asset.vaultAllocationBps / 100, 0), 100);

            return (
              <div key={asset.address}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className={`font-mono text-sm font-semibold ${tone.text}`}>
                      {asset.symbol}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-text-lo">
                      {shortAddress(asset.address)} · {formatUsd(asset.currentPriceUsd)} / TOKEN
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm text-text-hi">
                      {formatBpsAsPercent(asset.vaultAllocationBps)}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-text-lo">
                      {formatUsd(asset.vaultValueUsd)}
                    </div>
                  </div>
                </div>
                <div className="mt-2 h-2 overflow-hidden bg-surface-2">
                  <div
                    className={`h-full ${tone.bar} transition-[width] duration-500`}
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
