"use client";

import { useState } from "react";
import type { RebalanceRecord } from "@steward/shared-types";
import { formatRelativeTime, shortAddress } from "@/lib/format";

const OUTCOME_STYLE: Record<
  RebalanceRecord["outcome"],
  { label: string; text: string; bg: string; border: string }
> = {
  executed: { label: "EXECUTED", text: "text-executed", bg: "bg-executed-dim", border: "border-executed/40" },
  reverted: { label: "REVERTED", text: "text-reverted", bg: "bg-reverted-dim", border: "border-reverted/40" },
  skipped_no_change: {
    label: "SKIPPED",
    text: "text-text-lo",
    bg: "bg-surface-2",
    border: "border-hairline",
  },
};

function LedgerStamp({ record, onOpen }: { record: RebalanceRecord; onOpen: () => void }) {
  const style = OUTCOME_STYLE[record.outcome];
  const timestamp = record.executedAt ?? record.proposedAt;

  return (
    <button
      onClick={onOpen}
      className={`flex min-w-[180px] flex-col items-start gap-1 border ${style.border} ${style.bg} px-3 py-2 text-left transition-transform hover:-translate-y-0.5`}
    >
      <div className="flex w-full items-center justify-between">
        <span className={`font-mono text-[11px] font-semibold tracking-wide ${style.text}`}>
          {style.label}
        </span>
        {record.recovered && (
          <span className="rounded-sm bg-surface-2 px-1 font-mono text-[9px] text-text-lo">
            RECOVERED
          </span>
        )}
      </div>
      <span className="font-mono text-[11px] text-text-lo">{formatRelativeTime(timestamp)}</span>
    </button>
  );
}

function LedgerDetail({ record, onClose }: { record: RebalanceRecord; onClose: () => void }) {
  const style = OUTCOME_STYLE[record.outcome];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-xl overflow-y-auto border border-hairline bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className={`font-mono text-sm font-semibold ${style.text}`}>{style.label}</span>
          <button onClick={onClose} className="font-mono text-xs text-text-lo hover:text-text-hi">
            CLOSE
          </button>
        </div>

        {record.recovered ? (
          <p className="mt-4 text-sm text-text-lo">
            This rebalance was recovered from an on-chain event with no matching record — the
            executor most likely crashed before writing its own history. The original AI reasoning
            and confidence score were never captured and can't be shown here.
          </p>
        ) : (
          <>
            <div className="mt-4">
              <div className="font-mono text-[11px] tracking-widest text-ai">AI REASONING</div>
              <p className="mt-1.5 text-sm leading-relaxed text-text-hi">{record.aiReasoning}</p>
            </div>
            {record.aiConfidence !== null && (
              <div className="mt-4 flex items-center gap-2">
                <span className="font-mono text-[11px] tracking-widest text-text-lo">CONFIDENCE</span>
                <div className="h-1.5 w-32 bg-surface-2">
                  <div className="h-full bg-ai" style={{ width: `${record.aiConfidence * 100}%` }} />
                </div>
                <span className="font-mono text-xs text-text-lo">
                  {(record.aiConfidence * 100).toFixed(0)}%
                </span>
              </div>
            )}
          </>
        )}

        {record.revertReason && (
          <div className="mt-4">
            <div className="font-mono text-[11px] tracking-widest text-reverted">REVERT REASON</div>
            <p className="mt-1.5 font-mono text-xs text-text-lo">{record.revertReason}</p>
          </div>
        )}

        {record.swaps.length > 0 && (
          <div className="mt-5">
            <div className="font-mono text-[11px] tracking-widest text-text-lo">SWAPS</div>
            <div className="mt-2 flex flex-col gap-1.5">
              {record.swaps.map((swap, i) => (
                <div key={i} className="flex justify-between font-mono text-xs text-text-lo">
                  <span>
                    {shortAddress(swap.tokenIn)} → {shortAddress(swap.tokenOut)}
                  </span>
                  <span>
                    {swap.amountIn} → {swap.amountOut}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {record.txHash && (
          <div className="mt-5 font-mono text-[11px] text-text-lo">tx: {shortAddress(record.txHash)}</div>
        )}
      </div>
    </div>
  );
}

export function RebalanceLedger({ history }: { history: RebalanceRecord[] }) {
  const [selected, setSelected] = useState<RebalanceRecord | null>(null);

  return (
    <div className="border border-hairline bg-surface p-5">
      <div className="font-mono text-[11px] tracking-widest text-text-lo">REBALANCE LEDGER</div>
      <div className="mt-4 flex flex-wrap gap-2">
        {history.map((record) => (
          <LedgerStamp key={record.id} record={record} onOpen={() => setSelected(record)} />
        ))}
        {history.length === 0 && <div className="text-sm text-text-lo">No rebalances yet.</div>}
      </div>
      {selected && <LedgerDetail record={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}