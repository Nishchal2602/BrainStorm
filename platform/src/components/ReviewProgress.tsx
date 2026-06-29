'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { WorkflowExecutionCard } from './WorkflowExecutionCard'

const STAGES: [string, string][] = [
  ['sharedAnalysis', 'Shared Analysis'],
  ['pmReview', 'PM Review'],
  ['customerVoice', 'Customer Voice'],
  ['competitor', 'Competitor Intelligence'],
  ['recommendation', 'Recommendation'],
]
const ICON: Record<string, string> = { pending: '○', running: '◐', completed: '●', failed: '✕' }

interface RunStatus {
  status: string
  agentStatus?: Record<string, string> | null
  startedAt?: string | null
  completedAt?: string | null
}

/** Polls the review run and shows per-agent progress; refreshes the page when done. */
export function ReviewProgress({ runId }: { runId: string }) {
  const router = useRouter()
  const [run, setRun] = useState<RunStatus | null>(null)

  useEffect(() => {
    let alive = true
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/review-runs/${runId}`, { cache: 'no-store' })
        if (!res.ok || !alive) return
        const data = (await res.json()) as RunStatus
        setRun(data)
        if (data.status === 'Completed' || data.status === 'Failed') {
          clearInterval(id)
          router.refresh()
        }
      } catch {
        /* keep polling */
      }
    }, 2000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [runId, router])

  const st = run?.agentStatus ?? {}

  // When the review is executing on Lemma, the Workflow Execution card is the live
  // progress view (it shows the same per-step states plus the engine + workflow id).
  if (st.__engine === 'lemma') {
    return <WorkflowExecutionCard run={run ?? {}} />
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="text-sm font-semibold text-amber-800">
        Review running… {run?.status ? `(${run.status})` : ''}
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {STAGES.map(([key, label]) => {
          const state = st[key] ?? 'pending'
          return (
            <li key={key} className="flex items-center gap-2">
              <span className={state === 'failed' ? 'text-rose-600' : 'text-slate-700'}>{ICON[state]}</span>
              <span className={state === 'running' ? 'font-medium text-amber-900' : 'text-slate-700'}>{label}</span>
              <span className="text-xs text-slate-500">· {state}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
