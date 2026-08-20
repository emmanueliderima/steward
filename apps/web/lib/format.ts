export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function formatBpsAsPercent(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

export function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return "never";
  const diffMs = new Date(isoString).getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60_000);
  const abs = Math.abs(diffMin);

  const label =
    abs < 60
      ? `${abs}m`
      : abs < 60 * 24
        ? `${Math.round(abs / 60)}h`
        : `${Math.round(abs / (60 * 24))}d`;

  return diffMs >= 0 ? `in ${label}` : `${label} ago`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}