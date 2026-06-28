'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { api } from '@/lib/api'

export function CreateProductForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [summary, setSummary] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const product = await api<{ id: string }>('/api/products', {
        method: 'POST',
        body: JSON.stringify({ name, summary: summary || undefined }),
      })
      router.push(`/products/${product.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
      >
        New product
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
      <input
        autoFocus
        required
        placeholder="Product name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <textarea
        placeholder="Short summary (optional)"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        rows={2}
      />
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="flex gap-2">
        <button
          disabled={busy}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
