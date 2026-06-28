'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { api } from '@/lib/api'

// Demo control to advance a review run through its lifecycle (agents run in a later phase).
export function ReviewRunStatusControl({
  runId,
  nextStatuses,
}: {
  runId: string
  nextStatuses: string[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function move(status: string) {
    setBusy(true)
    try {
      await api(`/api/review-runs/${runId}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  if (nextStatuses.length === 0) return null
  return (
    <div className="flex gap-1.5">
      {nextStatuses.map((s) => (
        <button
          key={s}
          disabled={busy}
          onClick={() => move(s)}
          className="rounded-md border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100 disabled:opacity-50"
        >
          → {s}
        </button>
      ))}
    </div>
  )
}
