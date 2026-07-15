import { useState, type ReactNode } from 'react'
import { recordFeedbackEvent } from '@/lib/storage/feedback'
import { findingIdFor, type FindingSource } from '@/lib/analytics'
import { getClientId } from '@/lib/storage/client'

/** Side-panel-lifetime session id — stamped on every feedback event. */
const PANEL_SESSION_ID =
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `s_${Date.now()}`

function extVersion(): string {
  try {
    return chrome.runtime.getManifest().version
  } catch {
    return 'unknown'
  }
}

// Shared primitives for the tabbed review UI. Density per the design system:
// 1px slate dividers over shadows, mono uppercase chips, weight-based hierarchy.

export type ChipTone = 'rose' | 'amber' | 'sky' | 'blue' | 'emerald' | 'slate'

const CHIP_TONE: Record<ChipTone, string> = {
  rose: 'bg-rose-50 text-rose-600',
  amber: 'bg-amber-50 text-amber-700',
  sky: 'bg-sky-50 text-sky-600',
  blue: 'bg-blue-50 text-blue-600',
  emerald: 'bg-emerald-50 text-emerald-700',
  slate: 'bg-slate-100 text-slate-600',
}

/** Mono uppercase status/severity chip (e.g. CRITICAL, MISSING FROM PRD). */
export function Chip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${CHIP_TONE[tone]}`}
    >
      {children}
    </span>
  )
}

/** Subtle 👍/👎 pair, top-right of a review item. Emits an immutable feedback
 * event whose findingId is content-derived (findingIdFor) — so it joins the
 * FindingRecord the service worker persisted for the same source. */
export function Thumbs({
  source,
  reviewId,
  url,
}: {
  source: FindingSource
  reviewId?: string
  url?: string
}) {
  const [vote, setVote] = useState<'up' | 'down' | null>(null)

  const cast = (v: 'up' | 'down') => {
    setVote(v)
    if (!reviewId) return
    void getClientId()
      .catch(() => undefined)
      .then((clientId) =>
        recordFeedbackEvent({
          findingId: findingIdFor(source),
          reviewId,
          action: v === 'up' ? 'thumbs_up' : 'thumbs_down',
          agent: source.agent,
          extensionVersion: extVersion(),
          clientId,
          sessionId: PANEL_SESSION_ID,
          url,
        }),
      )
      .catch(() => {})
  }

  const cls = (active: boolean) =>
    `rounded p-0.5 transition ${active ? 'text-slate-700' : 'text-slate-300 hover:text-slate-500'}`

  return (
    <span className="flex shrink-0 items-center gap-1">
      <button type="button" aria-label="Helpful" onClick={() => cast('up')} className={cls(vote === 'up')}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill={vote === 'up' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
        </svg>
      </button>
      <button type="button" aria-label="Not helpful" onClick={() => cast('down')} className={cls(vote === 'down')}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill={vote === 'down' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 14V2M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
        </svg>
      </button>
    </span>
  )
}

/** Native-details accordion: chevron + title left, meta (chip/count) right.
 *  No animation — snappy reveal per the design system. */
export function Accordion({
  title,
  meta,
  defaultOpen,
  children,
}: {
  title: string
  meta?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  return (
    <details open={defaultOpen} className="group overflow-hidden rounded-lg border border-slate-200 bg-white">
      <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2.5 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-slate-900">
          <svg
            className="shrink-0 text-slate-400 transition-transform group-open:rotate-90"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span className="truncate">{title}</span>
        </span>
        {meta}
      </summary>
      <div className="divide-y divide-slate-100 border-t border-slate-200">{children}</div>
    </details>
  )
}

/** Empty tab state (standalone runs) with the Deep Analysis CTA. */
export function EmptyState({
  icon,
  title,
  body,
  onRunDeep,
}: {
  icon: string
  title: string
  body: string
  onRunDeep: () => void
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
      <div className="text-2xl">{icon}</div>
      <div className="mt-2 text-[13px] font-semibold text-slate-800">{title}</div>
      <p className="mx-auto mt-1 max-w-[260px] text-xs leading-relaxed text-slate-500">{body}</p>
      <button
        onClick={onRunDeep}
        className="mt-4 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
      >
        Run Deep Analysis
      </button>
    </div>
  )
}

/** Clickable in-document reference (GitHub-review style). Generic: any finding
 * type renders its location text through this and gets the pointer cursor,
 * hover underline, 📍 affordance, tooltip, and keyboard activation for free. */
export function JumpText({ text, onJump }: { text: string; onJump: () => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      title="📍 Jump to PRD — click to locate in document"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation() // don't toggle the row's <details>
        onJump()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          onJump()
        }
      }}
      className="group/jump inline cursor-pointer rounded-sm underline decoration-slate-300 decoration-dotted underline-offset-2 transition-colors hover:bg-brand-50 hover:text-brand-700 hover:decoration-brand-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500"
    >
      {text}
      <span
        aria-hidden="true"
        className="ml-1 inline-block text-[10px] opacity-0 transition-opacity group-hover/jump:opacity-100 group-focus-visible/jump:opacity-100"
      >
        📍
      </span>
    </span>
  )
}

/** Non-blocking toast pinned above the bottom tab bar. Render-once host —
 * pass the current message (or null) from the owner's state. */
export function Toast({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-16 left-1/2 z-30 w-max max-w-[90%] -translate-x-1/2 animate-toast-in rounded-lg bg-slate-900/95 px-3.5 py-2 text-xs font-medium text-white shadow-lg"
    >
      {message}
    </div>
  )
}

/** One clamped line of secondary text (scanning, not reading). */
export function truncate(s: string, max = 160): string {
  const t = s.trim()
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '…'
}

/** First sentence of a longer rationale — the "one-liner" the hero shows. */
export function firstSentence(s: string): string {
  const m = s.trim().match(/^.*?[.!?](?=\s|$)/)
  return m ? m[0] : s.trim()
}
