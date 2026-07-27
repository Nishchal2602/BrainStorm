import { useEffect } from 'react'

// Last gate before we write to someone's PRD. Mirrors ReviewContextModal's shell
// (overlay / panel / footer) so it feels like the same app, and adds Escape-to-
// cancel — cheap, and the destructive-ish action deserves an easy way out.
// Deliberately NOT a preview: it states the operation (how many, of what kind,
// and where), never the draft text — DiffPreview already covers content.

const MAX_LISTED = 5

export function ConfirmDialog({
  title,
  actionSummary,
  destinations,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string
  /** e.g. "5 appends · 3 replaces" */
  actionSummary?: string
  /** Target heading names — never draft content. */
  destinations?: string[]
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const listed = destinations?.slice(0, MAX_LISTED) ?? []
  const extra = (destinations?.length ?? 0) - listed.length

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-3 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <button
            onClick={onCancel}
            className="rounded px-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {actionSummary && <p className="mt-1.5 text-[12px] text-slate-600">{actionSummary}</p>}

        {listed.length > 0 && (
          <div className="mt-2">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Sections
            </p>
            <ul className="mt-1 space-y-0.5">
              {listed.map((d, i) => (
                <li key={i} className="truncate text-[12px] text-slate-700" title={d}>
                  • {d}
                </li>
              ))}
              {extra > 0 && <li className="text-[12px] text-slate-400">+{extra} more</li>}
            </ul>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
