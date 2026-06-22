import { useState } from 'react'
import { sendMessage } from '@/lib/messaging/types'
import { setSettings } from '@/lib/storage/settings'

export function ApiKeyGate({
  onSaved,
  onTryDemo,
}: {
  onSaved: () => void
  onTryDemo: () => void
}) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const trimmed = key.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    const res = await sendMessage({ type: 'VALIDATE_KEY', apiKey: trimmed })
    if (res.ok) {
      await setSettings({ apiKey: trimmed })
      onSaved()
    } else {
      setError(res.error)
    }
    setBusy(false)
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Connect your API key</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-slate-600">
          Paste a <strong>Google Gemini</strong> key (<code>AIza…</code>) or an{' '}
          <strong>Anthropic</strong> key (<code>sk-ant-…</code>). It's stored locally in your
          browser and is auto-detected — Gemini keys call Gemini, Anthropic keys call Claude.
        </p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="AIza… or sk-ant-…"
          className="mt-2 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500"
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        {error && <p className="mt-1.5 text-[12px] text-rose-600">{error}</p>}
        <button
          onClick={save}
          disabled={busy || !key.trim()}
          className="mt-2 w-full rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? 'Validating…' : 'Validate & Save'}
        </button>
        <div className="mt-2 flex gap-3">
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            className="inline-block text-[12px] text-brand-600 underline hover:text-brand-700"
          >
            Get a Gemini key →
          </a>
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noreferrer"
            className="inline-block text-[12px] text-brand-600 underline hover:text-brand-700"
          >
            Get an Anthropic key →
          </a>
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
        <p className="text-[12px] leading-relaxed text-amber-800">
          No key yet? Explore the full UI with <strong>sample outputs</strong> — no API call.
        </p>
        <button
          onClick={onTryDemo}
          className="mt-2 w-full rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-800 hover:bg-amber-100"
        >
          Explore with sample data →
        </button>
      </div>
    </div>
  )
}
