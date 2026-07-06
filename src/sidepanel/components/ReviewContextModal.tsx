import { useEffect, useRef, useState } from 'react'
import type { ReviewContext } from '@/lib/types'
import { DEFAULT_REVIEW_CONTEXT, getReviewDraft, setReviewDraft } from '@/lib/storage/profile'
import { TextField } from './fields'

/**
 * Collected before every PM Review. Prefilled from the autosaved draft so it's a
 * quick confirm, not re-entry. Required fields are validated before running.
 * Review type and familiarity are fixed for the MVP (PRD review, expert-level
 * critique), so they're forced here rather than asked.
 */
export function ReviewContextModal({
  onRun,
  onCancel,
  initialDeep = false,
}: {
  onRun: (ctx: ReviewContext, deep: boolean) => void
  onCancel: () => void
  /** Pre-check the deep toggle (e.g. opened from an empty-tab CTA). */
  initialDeep?: boolean
}) {
  const [ctx, setCtx] = useState<ReviewContext>(DEFAULT_REVIEW_CONTEXT)
  const [showErrors, setShowErrors] = useState(false)
  const [deep, setDeep] = useState(initialDeep)
  const touched = useRef(false)

  useEffect(() => {
    getReviewDraft().then((v) => {
      // Override any older saved draft: these two are fixed for now.
      if (!touched.current) setCtx({ ...v, reviewType: 'prd', familiarityLevel: 'domain_expert' })
    })
  }, [])

  const update = (patch: Partial<ReviewContext>) => {
    touched.current = true
    setCtx((c) => ({ ...c, ...patch }))
    setReviewDraft(patch).catch(() => {})
  }

  const errors = {
    featureName: ctx.featureName.trim() ? '' : 'Required',
    problemStatement: ctx.problemStatement.trim() ? '' : 'Required',
    targetUser: ctx.targetUser.trim() ? '' : 'Required',
  }
  const err = (k: keyof typeof errors) => (showErrors ? errors[k] : '')

  const submit = () => {
    if (errors.featureName || errors.problemStatement || errors.targetUser) {
      setShowErrors(true)
      return
    }
    onRun(ctx, deep)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Review context</h2>
          <button
            onClick={onCancel}
            className="rounded px-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <p className="mt-0.5 text-[12px] text-slate-500">
          A few specifics make this review judge your solution against the real problem and goal.
        </p>

        <div className="mt-3 space-y-3">
          <TextField
            label="Feature I'm building"
            required
            value={ctx.featureName}
            onChange={(v) => update({ featureName: v })}
            placeholder="AI-generated action items from meeting transcripts"
            error={err('featureName')}
          />
          <TextField
            label="Problem being solved"
            required
            value={ctx.problemStatement}
            onChange={(v) => update({ problemStatement: v })}
            placeholder="PMs spend too much time manually extracting tasks from meetings"
            error={err('problemStatement')}
          />
          <TextField
            label="Target user"
            required
            value={ctx.targetUser}
            onChange={(v) => update({ targetUser: v })}
            placeholder="Mid-level product managers at technology companies"
            error={err('targetUser')}
          />
          <TextField
            label="Success metric"
            value={ctx.successMetric}
            onChange={(v) => update({ successMetric: v })}
            placeholder="Reduce documentation time by 50%"
            hint="Optional but recommended."
          />

          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-2.5">
            <input
              type="checkbox"
              checked={deep}
              onChange={(e) => setDeep(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-brand-600"
            />
            <span className="text-[12px] leading-relaxed text-slate-600">
              <span className="font-medium text-slate-800">🧪 Deep multi-agent analysis (beta)</span>
              <br />
              Classifies the doc, runs specialist agents, and returns a build decision. Slower; more
              thorough.
            </span>
          </label>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className="flex-1 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            {deep ? 'Run Deep Analysis' : 'Run PM Review'}
          </button>
        </div>
      </div>
    </div>
  )
}
