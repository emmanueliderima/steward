import type { AssetOverviewRow } from "@steward/shared-types";
// import { formatUsd, formatBpsAsPercent } from "@/lib/format";

export function AssetAllocation({ assets }: { assets: AssetOverviewRow[] }) {
  return (
    <div className="border border-hairline bg-surface p-5">
      Asset Allocation
    </div>
  )
}