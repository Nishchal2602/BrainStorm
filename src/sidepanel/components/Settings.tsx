import { useEffect, useRef, useState } from 'react'
import type { ModelSetting, Settings as SettingsType, UserContext } from '@/lib/types'
import { setSettings } from '@/lib/storage/settings'
import { clearHistory } from '@/lib/storage/history'
import { getUserContext, setUserContext } from '@/lib/storage/profile'
import { sendMessage } from '@/lib/messaging/types'
import { config } from '@/lib/config'
import { isGeminiKey } from '@/lib/claude/client'
import {
  EXPERIENCE_OPTIONS,
  INDUSTRY_OPTIONS,
  ROLE_OPTIONS,
  STAGE_OPTIONS,
} from '@/lib/context/contextBlock'
import { Segmented } from './Segmented'
import { SelectField, TextField } from './fields'

export function Settings({
  settings,
  onChange,
  onBack,
}: {
  settings: SettingsType
  onChange: (s: SettingsType) => void
  onBack: () => void
}) {
  const [key, setKey] = useState(settings.apiKey)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [profile, setProfile] = useState<UserContext | null>(null)
  const profileTouched = useRef(false)

  useEffect(() => {
    getUserContext().then((v) => {
      if (!profileTouched.current) setProfile(v)
    })
  }, [])

  const updateProfile = (patch: Partial<UserContext>) => {
    profileTouched.current = true
    setProfile((p) => (p ? { ...p, ...patch } : p))
    setUserContext(patch).catch(() => {})
  }

  const saveKey = async () => {
    const trimmed = key.trim()
    if (!trimmed) return
    setBusy(true)
    setStatus(null)
    const res = await sendMessage({ type: 'VALIDATE_KEY', apiKey: trimmed })
    if (res.ok) {
      onChange(await setSettings({ apiKey: trimmed }))
      setStatus('Key saved.')
    } else {
      setStatus(res.error)
    }
    setBusy(false)
  }

  const setModel = async (model: ModelSetting) => {
    onChange(await setSettings({ model }))
  }

  // Mirrors createClaudeClient precedence: an explicitly pasted key wins, else the
  // build-time backend. When Gemini is active the Anthropic model picker is inert.
  const geminiActive = settings.apiKey ? isGeminiKey(settings.apiKey) : config.usesGemini

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Model</h3>
        {geminiActive ? (
          <p className="mb-2 mt-0.5 text-[12px] text-slate-500">
            A <strong>Gemini</strong> key is active — all actions use{' '}
            <code>{config.geminiModel}</code>. The picker below applies to Anthropic keys only.
          </p>
        ) : (
          <p className="mb-2 mt-0.5 text-[12px] text-slate-500">
            Auto uses Sonnet for PM Review and Haiku for the rest (best value).
          </p>
        )}
        <Segmented<ModelSetting>
          value={settings.model}
          onChange={setModel}
          options={[
            { value: 'auto', label: 'Auto', sub: 'recommended' },
            { value: 'claude-sonnet-4-6', label: 'Sonnet' },
            { value: 'claude-haiku-4-5', label: 'Haiku' },
          ]}
        />
      </div>

      <details className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">
          Profile <span className="font-normal text-slate-400">— used in every PM Review</span>
        </summary>
        {profile && (
          <div className="mt-3 space-y-3">
            <SelectField
              label="Role"
              value={profile.role}
              onChange={(v) => updateProfile({ role: v })}
              options={ROLE_OPTIONS}
              placeholder="Select your role"
            />
            <SelectField
              label="Experience level"
              value={profile.experienceLevel}
              onChange={(v) => updateProfile({ experienceLevel: v })}
              options={EXPERIENCE_OPTIONS}
              placeholder="Select experience"
            />
            <TextField
              label="Company name"
              value={profile.companyName}
              onChange={(v) => updateProfile({ companyName: v })}
              placeholder="Acme Inc."
              maxLength={80}
            />
            <SelectField
              label="Industry"
              value={profile.industry}
              onChange={(v) => updateProfile({ industry: v })}
              options={INDUSTRY_OPTIONS}
              placeholder="Select industry"
            />
            <SelectField
              label="Company stage"
              value={profile.companyStage}
              onChange={(v) => updateProfile({ companyStage: v })}
              options={STAGE_OPTIONS}
              placeholder="Select stage"
            />
          </div>
        )}
      </details>

      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Demo mode</h3>
            <p className="mt-0.5 text-[12px] text-slate-500">Sample outputs, no API call.</p>
          </div>
          <button
            role="switch"
            aria-checked={settings.demoMode}
            onClick={async () => onChange(await setSettings({ demoMode: !settings.demoMode }))}
            className={`relative h-6 w-11 rounded-full transition ${settings.demoMode ? 'bg-amber-500' : 'bg-slate-300'}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${settings.demoMode ? 'left-[22px]' : 'left-0.5'}`}
            />
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">History</h3>
        <button
          onClick={() => clearHistory().then(() => setStatus('History cleared.'))}
          className="mt-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Clear history
        </button>
      </div>

      <details className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">
          Advanced: use your own API key
        </summary>
        <p className="mb-2 mt-1.5 text-[12px] text-slate-500">
          {config.hasBackend
            ? 'This build uses a shared key — no key needed. A personal key is only used if you self-build without a backend.'
            : 'Paste a Google Gemini key (AIza…) or an Anthropic key (sk-ant-…). The provider is auto-detected; stored locally in your browser.'}
        </p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="AIza… or sk-ant-…"
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500"
        />
        {status && <p className="mt-1.5 text-[12px] text-slate-600">{status}</p>}
        <button
          onClick={saveKey}
          disabled={busy}
          className="mt-2 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? 'Validating…' : 'Save key'}
        </button>
      </details>

      <button
        onClick={onBack}
        className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        ← Back
      </button>
    </div>
  )
}
