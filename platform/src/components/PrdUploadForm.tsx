'use client'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

export function PrdUploadForm({ featureId }: { featureId: string }) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setError('Choose a file')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (title) fd.append('title', title)
      const res = await fetch(`/api/features/${featureId}/prds`, { method: 'POST', body: fd })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? 'Upload failed')
      setTitle('')
      if (fileRef.current) fileRef.current.value = ''
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
      <input ref={fileRef} type="file" className="text-sm" />
      <input
        placeholder="Title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="rounded-md border border-slate-300 px-2 py-1 text-sm"
      />
      <button disabled={busy} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
        {busy ? 'Uploading…' : 'Upload PRD'}
      </button>
      {error && <p className="w-full text-sm text-rose-600">{error}</p>}
    </form>
  )
}
