import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReadinessIssue, SuggestedPatch } from '@/lib/features/pmReview'
import type { JumpReference } from '@/lib/navigation'
import { normalizeRef } from '@/lib/navigation'
import { findingIdFor } from '@/lib/analytics'
import { appendPreview, diffStats, generateDiff } from '@/lib/diff'
import { GROUNDED_DRAFTS } from '@/lib/features/pmReview'
import { SKIP_NO_CHANGES, SKIP_NO_HEADING } from '@/lib/patchReview'
import type { PatchReview } from '@/sidepanel/usePatchReview'
import { clearDraft, getDraft, saveDraft } from '@/lib/storage/drafts'
import { recordPatchEvent, type PatchEventType } from '@/lib/storage/patchEvents'
import { sendMessage } from '@/lib/messaging/types'
import { Chip } from './bits'
import { DiffPreview } from './DiffPreview'

// The AI Draft block of one review issue: an editable, persistent, ready-to-
// paste PRD patch. Copilot model — the generated text is a starting point the
// user owns; edits are local state + chrome.storage, NEVER a regeneration.
// Collapsed by default: a 25-issue review must not render 25 open textareas.
// Apply (Notion only) inserts the edited draft under its anchored heading via
// the DOM — the location is resolved locally, never chosen by the model.

const SAVE_DEBOUNCE_MS = 500

const LABEL_CLS = 'font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-400'
const BTN_CLS =
  'rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'
const APPLY_BTN_CLS =
  'rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50'

/** Textarea height follows the content (clamped) — markdown stays scannable. */
const rowsFor = (text: string): number => Math.min(14, Math.max(4, text.split('\n').length + 1))

export function AiDraft({
  issue,
  category,
  patchId,
  reviewId,
  docUrl,
  tabId,
  patchReview,
  onJump,
}: {
  issue: ReadinessIssue
  /** Severity bucket ('critical' | 'medium' | 'minor') — analytics identity. */
  category: string
  /** Stable `${severity}-${index}` id (equals patch.id when a patch exists). */
  patchId: string
  reviewId?: string
  /** URL the review ran on (docMap) — Retry/Apply must target the same document. */
  docUrl?: string
  tabId?: number | null
  /** Accept/Reject triage, owned by App. Absent → the card degrades to Copy/Cancel. */
  patchReview?: PatchReview
  /** Jump-to-PRD callback — reused by the post-apply "View change" button. */
  onJump?: (ref: JumpReference) => void
}) {
  // Local because Retry can produce a patch the global result never had.
  const [patch, setPatch] = useState<SuggestedPatch | undefined>(issue.suggestedPatch)
  const [value, setValue] = useState(patch?.content ?? '')
  const [copied, setCopied] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  // Collapsed/expanded is controlled so Reject can fold the card away.
  const [open, setOpen] = useState(false)

  const saveTimer = useRef<number | undefined>(undefined)
  const openedOnce = useRef(false)
  const editedOnce = useRef(false)
  /** Has a generation been attempted? Distinguishes "not written yet" from "failed". */
  const attemptedOnce = useRef(false)
  /** When this draft became available — re-stamped by Retry. Clock for timeToDecisionMs. */
  const generatedAt = useRef(Date.now())

  const findingId = findingIdFor({ agent: 'pm_review', category, title: issue.title })
  const record = (type: PatchEventType, length?: number) =>
    void recordPatchEvent({ type, reviewId, patchId, findingId, length }).catch(() => {})

  // Hydrate a previously saved edit (drafts survive panel close + restart).
  useEffect(() => {
    if (!patch || !reviewId) return
    let alive = true
    void getDraft(reviewId, patchId)
      .then((text) => {
        if (alive && text != null) setValue(text)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewId, patchId, patch?.id])

  useEffect(() => () => window.clearTimeout(saveTimer.current), [])

  // ⚠️ EVERY hook must live ABOVE the `if (!patch)` early return below.
  // These three used to sit after it, which was a latent Rules-of-Hooks violation:
  // it only stayed invisible while `patch` was non-null on the first render (drafts
  // arrived inline with the review). Findings-first inverted that — cards now start
  // with no patch — so generating one changed the hook count mid-life and React
  // threw "Rendered more hooks than during the previous render", blanking the panel.
  // Hence the `patch?.` guards: these run in both branches now.

  // The section body captured at review time — the diff preview's "before".
  const original = patch?.anchor?.sectionText

  // Same computation the preview renders, so the button and the preview can never
  // disagree about whether there is anything to apply.
  const stats = useMemo(
    () =>
      diffStats(
        patch?.action === 'replace'
          ? generateDiff(original ?? '', value)
          : appendPreview(original, value),
      ),
    [original, value, patch?.action],
  )

  // Mirror of the server's ALREADY_APPLIED check (notionApi duplicate scan): warn
  // early, but never block — the captured text can be stale, and Notion is the
  // authority on what the section actually contains.
  const likelyDuplicate = useMemo(() => {
    const firstLine = value.split('\n').map((l) => l.trim()).find(Boolean)
    if (!firstLine || !original) return false
    return normalizeRef(original).includes(normalizeRef(firstLine))
  }, [original, value])

  // Whether this draft could actually be written, and why not when it can't.
  // Notion-connectivity/same-doc are checked once at the commit point (TriageBar);
  // these two are intrinsic to the draft itself.
  const skipReason = !patch?.anchor
    ? SKIP_NO_HEADING
    : !stats.hasChanges
      ? SKIP_NO_CHANGES
      : undefined

  const status = patchReview?.states[patchId]?.status ?? 'pending'
  const statusMessage = patchReview?.states[patchId]?.message

  // Publish the applyable descriptor so the batch can commit this row without
  // owning the textarea. Re-runs on every edit; unregisters on unmount so a draft
  // whose issue disappeared can never be applied. No patch yet → nothing to
  // register, so an undrafted issue never enters the triage counts.
  useEffect(() => {
    if (!patchReview) return
    if (!patch) {
      patchReview.register(patchId, null)
      return
    }
    patchReview.register(patchId, {
      patchId,
      category,
      findingId,
      action: patch.action,
      body: value,
      anchor: patch.anchor,
      headingText: patch.anchor?.headingText ?? patch.targetHeading,
      applicable: !skipReason,
      skipReason,
      addedChars: stats.added,
      removedChars: stats.removed,
      edited: editedOnce.current,
      generatedAt: generatedAt.current,
    })
    return () => patchReview.register(patchId, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchId, value, patch, skipReason, stats.added, stats.removed])

  if (!patch) {
    // Generation fallback — the model omitted the patch, emitted an empty
    // idempotent one, or heading validation dropped it. Never show nothing.
    const retry = async () => {
      setRetrying(true)
      setRetryError(null)
      attemptedOnce.current = true
      try {
        if (tabId == null) throw new Error('Open the reviewed document in the active tab, then retry.')
        const res = await sendMessage({
          type: 'GENERATE_PATCH',
          tabId,
          issue: { title: issue.title, where: issue.where, why: issue.why, impact: issue.impact, fix: issue.fix },
          patchId,
          reviewUrl: docUrl,
        })
        if (!res.ok) throw new Error(res.error)
        setPatch(res.data.patch)
        setValue(res.data.patch.content)
        record('generated', res.data.patch.content.length)
      } catch (e) {
        setRetryError(e instanceof Error ? e.message : 'Could not generate a draft. Try again.')
      } finally {
        setRetrying(false)
      }
    }
    // What "no draft" MEANS depends on the generation mode, so the copy follows it.
    // Drafts inline (GROUNDED_DRAFTS off): the review should have produced one, so
    // its absence is an anomaly — the model omitted it or emitted an empty
    // (idempotent) patch. Findings-first: absence is the normal initial state.
    const attempted = attemptedOnce.current
    const label = retrying
      ? GROUNDED_DRAFTS
        ? 'Writing…'
        : 'Generating…'
      : attempted
        ? 'Try again'
        : GROUNDED_DRAFTS
          ? 'Write draft'
          : 'Retry generation'
    const note = retrying
      ? 'Reading the target section and drafting the fix…'
      : GROUNDED_DRAFTS && !attempted
        ? 'Write a fix for this issue, grounded in the section it belongs to.'
        : 'No AI Draft generated.'
    return (
      <div className="mt-2 border-t border-slate-100 pt-2">
        <div className="flex items-center justify-between gap-2">
          <span className={LABEL_CLS}>AI Draft</span>
          <button
            type="button"
            onClick={retry}
            disabled={retrying}
            className={GROUNDED_DRAFTS ? APPLY_BTN_CLS : BTN_CLS}
          >
            {label}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">{note}</p>
        {retryError && <p className="mt-1 text-xs text-rose-600">{retryError}</p>}
      </div>
    )
  }

  const dirty = value !== patch.content

  const onEdit = (next: string) => {
    setValue(next)
    // Editing an already-applied draft re-opens it: `applied` is not a dead end,
    // so a typo can be fixed, re-accepted and reapplied instead of regenerated.
    if (patchReview && (patchReview.states[patchId]?.status ?? 'pending') === 'applied') {
      patchReview.decide(patchId, 'pending', findingId)
    }
    if (!editedOnce.current) {
      editedOnce.current = true
      record('edited', next.length)
    }
    if (!reviewId) return
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void saveDraft(reviewId, patchId, next), SAVE_DEBOUNCE_MS)
  }

  // Blur saves immediately — a crash between debounce ticks must not lose the edit.
  const onBlur = () => {
    if (!reviewId || !dirty) return
    window.clearTimeout(saveTimer.current)
    void saveDraft(reviewId, patchId, value)
  }

  const cancel = () => {
    window.clearTimeout(saveTimer.current)
    setValue(patch.content)
    if (reviewId) void clearDraft(reviewId, patchId)
    record('reset')
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
      void recordPatchEvent({
        type: 'copied',
        reviewId,
        patchId,
        findingId,
        length: value.length,
        addedChars: stats.added,
        removedChars: stats.removed,
        edited: editedOnce.current,
      }).catch(() => {})
    } catch {
      /* clipboard may be unavailable */
    }
  }

  const decide = (next: 'accepted' | 'rejected' | 'pending') => {
    patchReview?.decide(patchId, next, findingId)
    // Rejecting folds the card away; the draft stays reachable by reopening it.
    if (next === 'rejected') setOpen(false)
  }

  const retry = () => {
    if (tabId == null) return
    void patchReview?.retryOne(patchId, tabId, docUrl)
  }

  // Where this draft will land. The anchor's verbatim heading is exact (resolved
  // locally against the review-time doc map), so jump by `heading`; an unanchored
  // patch only has the model's wording, so let `where` run the fuzzy ladder.
  const targetLabel = patch.anchor?.headingText ?? patch.targetHeading
  const jumpToTarget = () => {
    if (!onJump) return
    onJump(patch.anchor ? { heading: patch.anchor.headingText } : { where: patch.targetHeading })
  }

  const confidence = patch.modelConfidence

  return (
    <details
      className="mt-2 border-t border-slate-100 pt-2"
      open={open}
      onToggle={(e) => {
        const isOpen = (e.target as HTMLDetailsElement).open
        setOpen(isOpen)
        if (isOpen && !openedOnce.current) {
          openedOnce.current = true
          record('opened', value.length)
        }
      }}
    >
      <summary className="flex cursor-pointer select-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
        <span className="text-[11px] font-medium text-slate-400 hover:text-slate-600">AI Draft ▸</span>
        {/* Status stays visible while collapsed — the whole point of triage. */}
        <span className="flex items-center gap-1">
          {status === 'accepted' && <Chip tone="emerald">Accepted</Chip>}
          {status === 'rejected' && <Chip tone="rose">Rejected</Chip>}
          {status === 'applying' && <Chip tone="slate">Applying…</Chip>}
          {status === 'applied' && <Chip tone="emerald">✓ Applied</Chip>}
          {status === 'failed' && <Chip tone="rose">Failed</Chip>}
          {status === 'skipped' && <Chip tone="slate">Skipped</Chip>}
        </span>
      </summary>
      <div className="mt-1.5 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Action + destination at a glance: "APPEND → Success Metrics".
              Clickable — jumps to that section in the open document. */}
          {onJump ? (
            <button
              type="button"
              onClick={jumpToTarget}
              title={`Jump to "${targetLabel}" in the document`}
              className="inline-flex max-w-full items-center rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600 transition hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <span className="truncate">
                {patch.action} → {targetLabel}
              </span>
            </button>
          ) : (
            <span
              className="inline-flex max-w-full items-center rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600"
              title={`${patch.action} → ${targetLabel}`}
            >
              <span className="truncate">
                {patch.action} → {targetLabel}
              </span>
            </span>
          )}
          {/* Informational only — modelConfidence never gates behavior. */}
          {confidence != null && confidence >= 80 && <Chip tone="emerald">High confidence</Chip>}
          {confidence != null && confidence < 50 && <Chip tone="amber">Needs review</Chip>}
        </div>
        {patch.rationale && <p className="text-[11px] leading-relaxed text-slate-400">{patch.rationale}</p>}
        <textarea
          value={value}
          onChange={(e) => onEdit(e.target.value)}
          onBlur={onBlur}
          rows={rowsFor(value)}
          spellCheck={false}
          aria-label="AI Draft — editable PRD patch"
          className="w-full resize-y rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs leading-relaxed text-slate-700 outline-none focus:border-brand-500"
        />
        <DiffPreview original={original} updated={value} action={patch.action} />
        {likelyDuplicate && (
          <p className="text-[11px] leading-relaxed text-amber-700">
            This draft may already be in the section — Notion may reject it as already applied.
          </p>
        )}
        {/* Why a skip happened, or why an apply failed — never a silent outcome. */}
        {statusMessage && (
          <p className={`text-[11px] leading-relaxed ${status === 'skipped' ? 'text-slate-500' : 'text-rose-600'}`}>
            {statusMessage}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <button type="button" onClick={cancel} disabled={!dirty} className={BTN_CLS}>
            Cancel
          </button>
          <button type="button" onClick={copy} className={BTN_CLS}>
            {copied ? 'Copied!' : 'Copy Markdown'}
          </button>

          {patchReview && status === 'applied' && onJump && (
            <button type="button" onClick={jumpToTarget} className={BTN_CLS}>
              View change
            </button>
          )}

          {patchReview && status === 'failed' && (
            <button type="button" onClick={retry} disabled={patchReview.busy} className={APPLY_BTN_CLS}>
              Retry
            </button>
          )}

          {patchReview && status === 'rejected' && (
            <button
              type="button"
              onClick={() => decide('pending')}
              className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Restore
            </button>
          )}

          {/* Accept / Reject: available while the row is still up for decision. */}
          {patchReview && (status === 'pending' || status === 'accepted' || status === 'skipped') && (
            <>
              <button
                type="button"
                onClick={() => decide('rejected')}
                disabled={patchReview.busy}
                className={BTN_CLS}
              >
                Reject
              </button>
              <button
                type="button"
                onClick={() => decide(status === 'accepted' ? 'pending' : 'accepted')}
                disabled={patchReview.busy}
                title={skipReason}
                className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status === 'accepted' ? 'Accepted ✓' : 'Accept'}
              </button>
            </>
          )}
        </div>
      </div>
    </details>
  )
}
