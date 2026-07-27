import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocMap } from '@/lib/navigation'
import { recordPatchEvent } from '@/lib/storage/patchEvents'
import { sendMessage } from '@/lib/messaging/types'
import {
  actionCounts,
  partitionAccepted,
  SKIP_NO_CHANGES,
  type PatchDescriptor,
  type PatchStatus,
  type ReviewPatchState,
} from '@/lib/patchReview'

// Accept/Reject triage + batch apply for the review on screen.
//
// Lives at App level on purpose: ReviewTab unmounts when you switch to the
// Competitor/Voice tab, and ReviewResult unmounts on a Settings/History
// round-trip — and "connect Notion in Settings" is a normal detour. Owning the
// triage here means neither wipes it. Nothing is persisted: a triage belongs to
// the review currently displayed.

/** Paces Notion (~3 req/s) between patches; the 429 retry in notionApi is the real net. */
const INTER_PATCH_MS = 400

export interface BatchOutcome {
  applied: number
  failed: number
  skipped: number
  total: number
}

export interface PatchReview {
  states: Record<string, ReviewPatchState>
  /** Publish/refresh a row's applyable descriptor. Pass null to unregister (on unmount). */
  register: (patchId: string, descriptor: PatchDescriptor | null) => void
  /** Accept / Reject / Restore, plus internal transitions. Records analytics. */
  decide: (patchId: string, status: PatchStatus, findingId?: string) => void
  /** Ids of rows that actually have a draft to decide on (issues without one aren't triage). */
  trackedIds: () => string[]
  /** Accepted descriptors in document order, split into applicable + skipped. */
  planApply: () => ReturnType<typeof partitionAccepted>
  /** Per-action counts for the confirm dialog. */
  actionCounts: typeof actionCounts
  /** Run the batch (call after the user confirms). */
  runBatch: (tabId: number, reviewUrl?: string) => Promise<void>
  /** Re-apply a single failed row. */
  retryOne: (patchId: string, tabId: number, reviewUrl?: string) => Promise<void>
  busy: boolean
  /** Result of the most recent batch, for the summary bar. */
  lastRun: BatchOutcome | null
}

export function usePatchReview(reviewId?: string, docMap?: DocMap): PatchReview {
  const [states, setStates] = useState<Record<string, ReviewPatchState>>({})
  const [busy, setBusy] = useState(false)
  const [lastRun, setLastRun] = useState<BatchOutcome | null>(null)

  // A ref, not state: rows re-register on every keystroke and the values are only
  // read at click time. Using state here would re-render every row per keystroke.
  const descriptors = useRef<Map<string, PatchDescriptor>>(new Map())

  // A NEW review replaces the triage. Keyed on reviewId (not on `result` being
  // cleared) so a review that FAILS leaves the previous triage untouched.
  useEffect(() => {
    descriptors.current.clear()
    setStates({})
    setLastRun(null)
  }, [reviewId])

  const register = useCallback((patchId: string, descriptor: PatchDescriptor | null) => {
    if (!descriptor) {
      // Unmount: drop it, so a draft whose issue disappeared can never be applied.
      descriptors.current.delete(patchId)
      return
    }
    descriptors.current.set(patchId, descriptor)
  }, [])

  const setStatus = useCallback((patchId: string, status: PatchStatus, message?: string) => {
    setStates((prev) => ({ ...prev, [patchId]: { status, message } }))
  }, [])

  const decide = useCallback(
    (patchId: string, status: PatchStatus, findingId?: string) => {
      setStatus(patchId, status)
      const type = status === 'accepted' ? 'accepted' : status === 'rejected' ? 'rejected' : 'restored'
      if (status !== 'accepted' && status !== 'rejected' && status !== 'pending') return
      const generatedAt = descriptors.current.get(patchId)?.generatedAt
      void recordPatchEvent({
        type,
        reviewId,
        patchId,
        findingId,
        timeToDecisionMs: generatedAt ? Date.now() - generatedAt : undefined,
      }).catch(() => {})
    },
    [reviewId, setStatus],
  )

  const accepted = useCallback(
    () =>
      [...descriptors.current.values()].filter((d) => states[d.patchId]?.status === 'accepted'),
    [states],
  )

  const planApply = useCallback(
    () => partitionAccepted(accepted(), docMap),
    [accepted, docMap],
  )

  const trackedIds = useCallback(() => [...descriptors.current.keys()], [])

  /** Apply one descriptor. Returns true on success; never throws. */
  const applyOne = useCallback(
    async (d: PatchDescriptor, tabId: number, reviewUrl?: string): Promise<boolean> => {
      if (!d.anchor) {
        setStatus(d.patchId, 'skipped', d.skipReason)
        return false
      }
      setStatus(d.patchId, 'applying')
      const findingId = d.findingId
      const startedAt = Date.now()
      try {
        const res = await sendMessage({
          type: 'APPLY_PATCH',
          tabId,
          action: d.action,
          anchor: d.anchor,
          body: d.body,
          reviewUrl,
        })
        const ok = res.ok && res.data.success
        const code = res.ok ? res.data.code : res.code
        const reason = res.ok ? res.data.reason : res.error
        setStatus(d.patchId, ok ? 'applied' : 'failed', ok ? undefined : reason)
        void recordPatchEvent({
          type: ok ? 'applied' : 'apply_failed',
          reviewId,
          patchId: d.patchId,
          findingId,
          length: d.body.length,
          durationMs: Date.now() - startedAt,
          errorCode: ok ? undefined : code,
          addedChars: d.addedChars,
          removedChars: d.removedChars,
          edited: d.edited,
        }).catch(() => {})
        return ok
      } catch (e) {
        // One row throwing must never abort the rest of the batch.
        setStatus(d.patchId, 'failed', e instanceof Error ? e.message : 'Could not apply the draft.')
        void recordPatchEvent({
          type: 'apply_failed',
          reviewId,
          patchId: d.patchId,
          durationMs: Date.now() - startedAt,
        }).catch(() => {})
        return false
      }
    },
    [reviewId, setStatus],
  )

  const runBatch = useCallback(
    async (tabId: number, reviewUrl?: string) => {
      const { applicable, skipped } = planApply()
      if (!applicable.length && !skipped.length) return

      setBusy(true)
      const startedAt = Date.now()

      // Mark skips up front with their reason — never a silent drop.
      for (const d of skipped) setStatus(d.patchId, 'skipped', d.skipReason ?? SKIP_NO_CHANGES)

      let applied = 0
      let failed = 0
      // Sequential, in document order. Each row flips applying → applied/failed
      // as it goes, so progress is visible instead of arriving all at once.
      for (let i = 0; i < applicable.length; i++) {
        const ok = await applyOne(applicable[i], tabId, reviewUrl)
        if (ok) applied += 1
        else failed += 1
        if (i < applicable.length - 1) await new Promise((r) => setTimeout(r, INTER_PATCH_MS))
      }

      const outcome: BatchOutcome = {
        applied,
        failed,
        skipped: skipped.length,
        total: applicable.length + skipped.length,
      }
      setLastRun(outcome)
      setBusy(false)
      // Metadata only — never draft or PRD text.
      console.log('[PM Co-Pilot] apply accepted', {
        ...outcome,
        durationMs: Date.now() - startedAt,
      })
    },
    [applyOne, planApply, setStatus],
  )

  const retryOne = useCallback(
    async (patchId: string, tabId: number, reviewUrl?: string) => {
      const d = descriptors.current.get(patchId)
      if (!d) return
      setBusy(true)
      await applyOne(d, tabId, reviewUrl)
      setBusy(false)
    },
    [applyOne],
  )

  return {
    states,
    register,
    decide,
    trackedIds,
    planApply,
    actionCounts,
    runBatch,
    retryOne,
    busy,
    lastRun,
  }
}
