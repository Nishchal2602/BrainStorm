'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { api } from '@/lib/api'

export function StageControl({
  featureId,
  currentStage,
  nextStages,
}: {
  featureId: string
  currentStage: string
  nextStages: string[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function move(stage: string) {
    setBusy(true)
    try {
      await api(`/api/features/${featureId}`, { method: 'PATCH', body: JSON.stringify({ stage }) })
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Stage: {currentStage}</span>
      {nextStages.map((s) => (
        <button
          key={s}
          disabled={busy}
          onClick={() => move(s)}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-100 disabled:opacity-50"
        >
          → {s}
        </button>
      ))}
    </div>
  )
}
