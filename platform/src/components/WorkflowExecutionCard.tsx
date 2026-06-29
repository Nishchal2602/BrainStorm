// Presentational only (no hooks) — safe to render from both the server Feature page
// and the client poller. Renders the "Executed via Lemma" branding + per-step state,
// fed entirely by an already-loaded ReviewRun (agentStatus carries the reserved
// __engine / __lemmaRunId keys the LemmaReviewRunner stashes). Returns null for
// non-Lemma runs, so it's a no-op when reviews use the in-process orchestrator.

const STEPS: [string, string][] = [
  ['sharedAnalysis', 'Document Analysis'],
  ['pmReview', 'PM Review'],
  ['customerVoice', 'Customer Voice'],
  ['competitor', 'Competitor Intelligence'],
  ['recommendation', 'Recommendation'],
]
const ICON: Record<string, string> = { pending: '○', running: '◐', completed: '✓', failed: '✕' }
const ICON_COLOR: Record<string, string> = {
  pending: 'text-slate-300',
  running: 'text-violet-500',
  completed: 'text-emerald-500',
  failed: 'text-rose-500',
}

interface RunLike {
  status?: string | null
  agentStatus?: Record<string, string> | null
  startedAt?: string | Date | null
  completedAt?: string | Date | null
}

const fmtTime = (t?: string | Date | null): string => {
  if (!t) return '—'
  const d = typeof t === 'string' ? new Date(t) : t
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString()
}

export function WorkflowExecutionCard({ run }: { run: RunLike }) {
  const ag = run.agentStatus ?? {}
  if (ag.__engine !== 'lemma') return null
  const workflowId = ag.__lemmaRunId

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-violet-900">Review Execution</h3>
        <span className="inline-flex items-center gap-1 rounded-full bg-violet-600 px-2 py-0.5 text-xs font-medium text-white">
          ✓ Executed using Lemma Workflow
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <Field label="Workflow Engine" value="Lemma" />
        <Field label="Workflow Status" value={run.status ?? '—'} />
        <Field label="Started" value={fmtTime(run.startedAt)} />
        <Field label="Completed" value={fmtTime(run.completedAt)} />
      </dl>
      {workflowId && (
        <div className="mt-2 text-xs">
          <span className="font-medium uppercase tracking-wide text-violet-400">Workflow ID</span>
          <div className="mt-0.5 truncate font-mono text-violet-800" title={workflowId}>
            {workflowId}
          </div>
        </div>
      )}

      <div className="mt-3">
        <div className="text-xs font-medium uppercase tracking-wide text-violet-400">Steps</div>
        <ul className="mt-1 space-y-1 text-sm">
          {STEPS.map(([key, label]) => {
            const state = ag[key] ?? 'pending'
            return (
              <li key={key} className="flex items-center gap-2">
                <span className={ICON_COLOR[state] ?? 'text-slate-300'}>{ICON[state] ?? '○'}</span>
                <span className={state === 'running' ? 'font-medium text-violet-900' : 'text-slate-700'}>
                  {label}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium uppercase tracking-wide text-violet-400">{label}</dt>
      <dd className="mt-0.5 text-violet-900">{value}</dd>
    </div>
  )
}
