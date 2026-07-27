import type { StatusCounts } from '@/lib/patchReview'
import type { BatchOutcome } from '@/sidepanel/usePatchReview'
import { Chip } from './bits'

// Triage summary + the single commit point. Sits above the issue list so it stays
// visible when the Functional Specs accordion is collapsed. Only non-zero counts
// render — a ~400px side panel can't afford six chips of zeroes.

export function TriageBar({
  counts,
  lastRun,
  busy,
  canApply,
  disabledReason,
  onApply,
}: {
  counts: StatusCounts
  lastRun: BatchOutcome | null
  busy: boolean
  canApply: boolean
  /** Why Apply is unavailable (Notion not connected, wrong doc, …). */
  disabledReason?: string
  onApply: () => void
}) {
  const n = counts.accepted
  // Nothing decided yet and nothing applied → don't take up space at all.
  if (n === 0 && counts.rejected === 0 && counts.applied === 0 && counts.failed === 0 && counts.skipped === 0) {
    return null
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {n > 0 && <Chip tone="emerald">{n} accepted</Chip>}
        {counts.pending > 0 && <Chip tone="slate">{counts.pending} pending</Chip>}
        {counts.rejected > 0 && <Chip tone="rose">{counts.rejected} rejected</Chip>}
        {counts.applied > 0 && <Chip tone="emerald">{counts.applied} applied</Chip>}
        {counts.failed > 0 && <Chip tone="rose">{counts.failed} failed</Chip>}
        {counts.skipped > 0 && <Chip tone="slate">{counts.skipped} skipped</Chip>}
      </div>

      <button
        type="button"
        onClick={onApply}
        disabled={!canApply || busy || n === 0}
        title={n === 0 ? 'Accept at least one draft first.' : disabledReason}
        className="mt-2 w-full rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Applying…' : `Apply Accepted (${n})`}
      </button>

      {lastRun && !busy && (
        <p className="mt-1.5 text-[11px] text-slate-500">
          Applied {lastRun.applied} of {lastRun.total}
          {lastRun.failed > 0 && <span className="text-rose-600"> · {lastRun.failed} failed</span>}
          {lastRun.skipped > 0 && <span> · {lastRun.skipped} skipped</span>}
        </p>
      )}
    </section>
  )
}
