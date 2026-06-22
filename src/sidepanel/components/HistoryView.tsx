import { useEffect, useState } from 'react'
import type { HistoryEntry, ResultDoc } from '@/lib/types'
import { listHistory } from '@/lib/storage/history'
import { getFeature } from '@/lib/features/registry'
import { SOURCE_LABEL } from '@/lib/context/sourceDetect'
import { tokenTotal } from '@/lib/usage'

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function HistoryView({
  onOpen,
  onBack,
}: {
  onOpen: (result: ResultDoc) => void
  onBack: () => void
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])

  useEffect(() => {
    listHistory().then(setEntries)
  }, [])

  return (
    <div className="space-y-2">
      <button
        onClick={onBack}
        className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        ← Back
      </button>
      {entries.length === 0 && (
        <p className="px-1 py-6 text-center text-[13px] text-slate-500">No history yet.</p>
      )}
      {entries.map((e) => (
        <button
          key={e.id}
          onClick={() => onOpen(e.result)}
          className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-left shadow-sm hover:bg-slate-50"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900">
              {getFeature(e.feature)?.label ?? e.feature}
            </span>
            <span className="text-[11px] text-slate-400">{timeAgo(e.timestamp)}</span>
          </div>
          <p className="mt-0.5 truncate text-[12px] text-slate-600" title={e.pageTitle}>
            {e.pageTitle}
          </p>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
              {SOURCE_LABEL[e.source]}
            </span>
            {e.result.usage && (
              <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                ~{tokenTotal(e.result.usage).toLocaleString()} tok
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  )
}
