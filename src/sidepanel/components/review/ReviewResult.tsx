import { useEffect, useRef, useState } from 'react'
import type { ResultDoc } from '@/lib/types'
import type { ReviewData } from '@/lib/review'
import { formatTokens } from '@/lib/usage'
import { resolveReference, sameDoc, type JumpReference } from '@/lib/navigation'
import { sendMessage } from '@/lib/messaging/types'
import { Toast } from './bits'
import { ReviewTab } from './ReviewTab'
import { VoiceTab } from './VoiceTab'
import { CompetitorTab } from './CompetitorTab'

const TOAST_PRD_CLOSED = 'Cannot jump to section. Open the reviewed PRD to navigate.'
const TOAST_NOT_FOUND = 'Section not found. The PRD may have changed since this review was created.'

// Tabbed review experience for results carrying structured ReviewData.
// PM Review / Competitor / Voice each own a single responsibility; the
// bottom tab bar is fixed (App pads the container so content clears it).

type Tab = 'review' | 'competitor' | 'voice'

const TABS: Array<{ id: Tab; label: string; icon: JSX.Element }> = [
  {
    id: 'review',
    label: 'PM Review',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    id: 'competitor',
    label: 'Competitor',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 20h18" />
        <path d="M6 20v-6M12 20V6M18 20v-9" />
      </svg>
    ),
  },
  {
    id: 'voice',
    label: 'Voice',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
]

export function ReviewResult({
  result,
  review,
  url,
  tabId,
  onRunDeep,
}: {
  result: ResultDoc
  review: ReviewData
  url?: string
  tabId?: number | null
  onRunDeep: () => void
}) {
  const [tab, setTab] = useState<Tab>('review')
  const [copied, setCopied] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const showToast = (message: string) => {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3000)
  }
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  // Jump-to-PRD: guard (is the reviewed doc open?) → resolve against the
  // review-time DocMap → locate + highlight in the tab. All failures are
  // non-blocking toasts — never console errors.
  const handleJump = async (reference: JumpReference) => {
    const ref: JumpReference = { docMap: review.docMap, ...reference }
    if (tabId == null || !ref.docMap || !sameDoc(url, ref.docMap.url)) {
      showToast(TOAST_PRD_CLOSED)
      return
    }
    const target = resolveReference(ref)
    if (!target) {
      showToast(TOAST_NOT_FOUND)
      return
    }
    try {
      const res = await sendMessage({ type: 'JUMP_TO_REFERENCE', tabId, target })
      if (!res.ok) showToast(TOAST_PRD_CLOSED)
      else if (!res.data.found) showToast(TOAST_NOT_FOUND)
    } catch {
      showToast(TOAST_PRD_CLOSED)
    }
  }

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
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{result.title}</h2>
          {result.usage && <p className="text-[11px] text-slate-400">{formatTokens(result.usage)}</p>}
        </div>
        <button
          onClick={copy}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {tab === 'review' && (
        <ReviewTab
          readiness={review.readiness}
          insights={review.insights}
          reviewId={review.reviewId}
          url={url}
          onJump={handleJump}
        />
      )}
      {tab === 'competitor' && (
        <CompetitorTab competitor={review.competitor} reviewId={review.reviewId} url={url} onRunDeep={onRunDeep} />
      )}
      {tab === 'voice' && (
        <VoiceTab voice={review.voice} verdict={review.verdict} reviewId={review.reviewId} url={url} onRunDeep={onRunDeep} />
      )}

      <Toast message={toast} />

      {/* Fixed bottom tab bar — always visible while a review is open. */}
      <nav className="fixed bottom-0 left-0 right-0 z-20 flex border-t border-slate-200 bg-white">
        {TABS.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition ${
                active ? 'font-semibold text-brand-600' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
