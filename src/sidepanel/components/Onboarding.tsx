import { useEffect, useRef, useState } from 'react'
import type { UserContext } from '@/lib/types'
import {
  DEFAULT_USER_CONTEXT,
  getUserContext,
  setOnboardingDismissed,
  setUserContext,
} from '@/lib/storage/profile'
import {
  EXPERIENCE_OPTIONS,
  INDUSTRY_OPTIONS,
  ROLE_OPTIONS,
  STAGE_OPTIONS,
} from '@/lib/context/contextBlock'
import { SelectField, TextField } from './fields'

const STEPS = ['Profile', 'Company', 'Product']

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [ctx, setCtx] = useState<UserContext>(DEFAULT_USER_CONTEXT)
  const [step, setStep] = useState(0)
  const touched = useRef(false)

  useEffect(() => {
    // Don't let the async load overwrite edits the user already started typing.
    getUserContext().then((v) => {
      if (!touched.current) setCtx(v)
    })
  }, [])

  // Autosave every change so progress is never lost (UX req: save drafts).
  const update = (patch: Partial<UserContext>) => {
    touched.current = true
    setCtx((c) => ({ ...c, ...patch }))
    setUserContext(patch).catch(() => {})
  }

  const finish = async () => {
    // Commit the full in-memory state so the saved profile always matches the UI.
    await setUserContext({ ...ctx, onboardedAt: Date.now() })
    onDone()
  }
  const skip = async () => {
    await setOnboardingDismissed(true)
    onDone()
  }

  const last = step === STEPS.length - 1

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Set up PM Co-Pilot</h2>
          <span className="text-[11px] text-slate-400">
            Step {step + 1} of {STEPS.length}
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-brand-500 transition-all"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-slate-500">
          A few quick details make every PM Review specific to your product. Under a minute — you can
          skip and finish later in Settings.
        </p>

        <div className="mt-3 space-y-3">
          {step === 0 && (
            <>
              <SelectField
                label="Role"
                value={ctx.role}
                onChange={(v) => update({ role: v })}
                options={ROLE_OPTIONS}
                placeholder="Select your role"
              />
              <SelectField
                label="Experience level"
                value={ctx.experienceLevel}
                onChange={(v) => update({ experienceLevel: v })}
                options={EXPERIENCE_OPTIONS}
                placeholder="Select experience"
              />
            </>
          )}
          {step === 1 && (
            <>
              <TextField
                label="Company name"
                value={ctx.companyName}
                onChange={(v) => update({ companyName: v })}
                placeholder="Acme Inc."
                maxLength={80}
              />
              <SelectField
                label="Industry"
                value={ctx.industry}
                onChange={(v) => update({ industry: v })}
                options={INDUSTRY_OPTIONS}
                placeholder="Select industry"
              />
              <SelectField
                label="Company stage"
                value={ctx.companyStage}
                onChange={(v) => update({ companyStage: v })}
                options={STAGE_OPTIONS}
                placeholder="Select stage"
              />
            </>
          )}
          {step === 2 && (
            <>
              <TextField
                label="Product name"
                value={ctx.productName}
                onChange={(v) => update({ productName: v })}
                placeholder="PM Copilot"
                maxLength={80}
              />
              <TextField
                label="What product are you building?"
                value={ctx.productDescription}
                onChange={(v) => update({ productDescription: v })}
                placeholder="AI copilot that helps product managers review PRDs."
              />
              <TextField
                label="Who is your primary user?"
                value={ctx.primaryUser}
                onChange={(v) => update({ primaryUser: v })}
                placeholder="Product managers at B2B SaaS companies."
              />
              <TextField
                label="What business outcome are you trying to achieve?"
                value={ctx.businessGoal}
                onChange={(v) => update({ businessGoal: v })}
                placeholder="Increase PM productivity and improve documentation quality."
              />
            </>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Back
            </button>
          )}
          <button
            onClick={() => (last ? finish() : setStep(step + 1))}
            className="flex-1 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            {last ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>

      <button
        onClick={skip}
        className="w-full text-center text-[12px] text-slate-500 underline hover:text-slate-700"
      >
        Skip for now
      </button>
    </div>
  )
}
