export function StatPanel({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "executed" | "pending" | "reverted";
  hint?: string;
}) {
  const toneClass = {
    neutral: "text-text-hi",
    executed: "text-executed",
    pending: "text-pending",
    reverted: "text-reverted",
  }[tone];

  return (
    <div className="border border-hairline bg-surface p-5">
      <div className="font-mono text-[11px] tracking-widest text-text-lo">{label}</div>
      <div className={`mt-2 font-mono text-2xl font-medium ${toneClass}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-text-lo">{hint}</div>}
    </div>
  );
}