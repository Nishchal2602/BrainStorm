'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { api } from '@/lib/api'

export interface DecisionView {
  id: string
  title: string
  decision: string
  rationale: string | null
  status: string
  createdAt: string
}

const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-slate-100 text-slate-600',
  Proposed: 'bg-amber-100 text-amber-700',
  Approved: 'bg-emerald-100 text-emerald-700',
  Rejected: 'bg-rose-100 text-rose-700',
  Superseded: 'bg-slate-100 text-slate-500',
}

export function DecisionPanel({
  productId,
  decisions,
}: {
  productId: string
  decisions: DecisionView[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [decision, setDecision] = useState('')
  const [rationale, setRationale] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await api(`/api/products/${productId}/decisions`, {
        method: 'POST',
        body: JSON.stringify({ title, decision, rationale: rationale || undefined }),
      })
      setTitle('')
      setDecision('')
      setRationale('')
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  async function transition(id: string, status: string) {
    try {
      await api(`/api/decisions/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Decisions</h2>
        <button onClick={() => setOpen((v) => !v)} className="text-sm font-medium text-slate-900 underline">
          {open ? 'Cancel' : '+ Propose decision'}
        </button>
      </div>

      {open && (
        <form onSubmit={create} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
          <input
            required
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            placeholder="Decision"
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <textarea
            placeholder="Rationale (optional)"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button disabled={busy} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
            {busy ? 'Proposing…' : 'Propose (Proposed)'}
          </button>
        </form>
      )}

      {decisions.length === 0 ? (
        <p className="text-sm text-slate-500">No decisions yet.</p>
      ) : (
        <ul className="space-y-2">
          {decisions.map((d) => (
            <li key={d.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{d.title}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLORS[d.status] ?? 'bg-slate-100'}`}>
                  {d.status}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-700">{d.decision}</p>
              {d.rationale && <p className="mt-1 text-xs text-slate-500">{d.rationale}</p>}
              {d.status === 'Proposed' && (
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => transition(d.id, 'Approved')}
                    className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => transition(d.id, 'Rejected')}
                    className="rounded-md border border-rose-300 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                  >
                    Reject
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
