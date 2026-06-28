'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { api } from '@/lib/api'

export function StartReviewButton({
  productId,
  featureId,
  prdId,
}: {
  productId: string
  featureId: string
  prdId?: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function start() {
    setBusy(true)
    try {
      await api(`/api/products/${productId}/review-runs`, {
        method: 'POST',
        body: JSON.stringify({ featureId, prdId, trigger: prdId ? 'PRDUpload' : 'Manual' }),
      })
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={start}
      disabled={busy}
      className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
    >
      {busy ? 'Starting…' : 'Start review'}
    </button>
  )
}
