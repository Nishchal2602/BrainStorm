import { useState } from 'react'
import type { ResultDoc } from '@/lib/types'
import { formatTokens } from '@/lib/usage'
import { Card } from './Card'

export function ResultView({ result }: { result: ResultDoc }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.copyText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard may be unavailable */
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{result.title}</h2>
        <button
          onClick={copy}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      {result.usage && (
        <p className="-mt-1 text-[11px] text-slate-400">{formatTokens(result.usage)}</p>
      )}
      {result.sections.map((s, i) => (
        <Card key={i} section={s} />
      ))}
    </div>
  )
}
