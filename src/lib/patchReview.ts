import type { DocMap } from '@/lib/navigation'
import { matchHeading, STRICT_MATCH } from '@/lib/navigation'
import type { PatchAnchor } from '@/lib/features/pmReview'

// Accept / Reject triage for one review, plus the batch-apply bookkeeping.
// Pure logic only — no React, no messaging, no storage (usePatchReview wires
// those). Nothing here is persisted: a triage belongs to the review on screen.

/**
 * One draft's place in the triage. `skipped` is deliberately its own status
 * rather than a flavour of `failed`: "there was nothing to apply" is not an error
 * and must not read like one.
 */
export type PatchStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'applying'
  | 'applied'
  | 'failed'
  | 'skipped'

export interface ReviewPatchState {
  status: PatchStatus
  /** Failure reason OR skip reason — always shown, never a silent drop. */
  message?: string
}

/**
 * What a row publishes so the batch can apply it without owning the textarea.
 * Registered by AiDraft on mount + on every edit, and DELETED on unmount so a
 * stale draft can never be applied after its issue disappears.
 */
export interface PatchDescriptor {
  patchId: string
  /** Severity bucket — the tie-break when two drafts target the same heading. */
  category: string
  /** Content-derived finding id, so triage/apply events join the persisted findings. */
  findingId?: string
  action: 'append' | 'replace'
  /** The CURRENT (possibly edited) draft text. */
  body: string
  anchor?: PatchAnchor
  /** Verbatim heading, for the confirm dialog's destination list. */
  headingText: string
  /** False when there is no anchor or no net change — see skipReason. */
  applicable: boolean
  /** Why this can't be applied (set whenever applicable is false). */
  skipReason?: string
  /** Diff sizes from the preview — carried so the apply event keeps its metrics. */
  addedChars?: number
  removedChars?: number
  /** Did the user edit the generated draft before committing to it? */
  edited?: boolean
  /** When this draft first became available (re-stamped by Retry) — clock for timeToDecisionMs. */
  generatedAt: number
}

export type StatusCounts = Record<PatchStatus, number>

const EMPTY_COUNTS: StatusCounts = {
  pending: 0,
  accepted: 0,
  rejected: 0,
  applying: 0,
  applied: 0,
  failed: 0,
  skipped: 0,
}

/** Tally statuses for the summary bar. Only counts drafts that actually exist. */
export function countStatuses(
  states: Record<string, ReviewPatchState>,
  patchIds: string[],
): StatusCounts {
  const counts: StatusCounts = { ...EMPTY_COUNTS }
  for (const id of patchIds) counts[states[id]?.status ?? 'pending'] += 1
  return counts
}

// Tie-break when two patches target the same heading. Mirrors ISSUE_BUCKETS order;
// an unknown category falls to 99 rather than sorting unpredictably.
const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  compliance: 1,
  technical: 2,
  medium: 3,
  missing_requirement: 4,
  missing_acceptance_criteria: 5,
  minor: 6,
}

/**
 * Document position of a patch's target heading, or null when unresolvable.
 *
 * blockId FIRST and by design: large PRDs very often repeat a heading (two
 * `## API`), which makes text matching ambiguous, while a Notion block id is
 * unique. Text is only consulted when no blockId was captured (non-Notion pages)
 * or the block has since disappeared.
 */
export function headingPosition(anchor: PatchAnchor | undefined, docMap?: DocMap): number | null {
  const headings = docMap?.headings ?? []
  if (!anchor || !headings.length) return null

  if (anchor.headingBlockId) {
    const byBlock = headings.findIndex((h) => h.blockId && h.blockId === anchor.headingBlockId)
    if (byBlock !== -1) return byBlock
  }
  const byText = headings.findIndex((h) => h.text === anchor.headingText)
  if (byText !== -1) return byText

  // STRICT: this position decides apply ORDER and the section a merge lands in.
  return matchHeading(anchor.heading, headings.map((h) => h.text), STRICT_MATCH)
}

/**
 * Sort descriptors into original PRD order. Edits must never be reordered:
 * the UI groups by severity, but the document is the authority. Unresolvable
 * targets sort last (they'd be skipped anyway); ties break by severity then id
 * so the result is stable.
 */
export function orderPatches(descriptors: PatchDescriptor[], docMap?: DocMap): PatchDescriptor[] {
  return descriptors
    .map((d) => ({ d, pos: headingPosition(d.anchor, docMap) }))
    .sort((a, b) => {
      const ap = a.pos ?? Number.MAX_SAFE_INTEGER
      const bp = b.pos ?? Number.MAX_SAFE_INTEGER
      if (ap !== bp) return ap - bp
      const ar = SEVERITY_RANK[a.d.category] ?? 99
      const br = SEVERITY_RANK[b.d.category] ?? 99
      if (ar !== br) return ar - br
      return a.d.patchId.localeCompare(b.d.patchId)
    })
    .map((x) => x.d)
}

/** Accepted drafts split into what can actually be applied and what cannot (with reasons). */
export function partitionAccepted(
  descriptors: PatchDescriptor[],
  docMap?: DocMap,
): { applicable: PatchDescriptor[]; skipped: PatchDescriptor[] } {
  const applicable: PatchDescriptor[] = []
  const skipped: PatchDescriptor[] = []
  for (const d of orderPatches(descriptors, docMap)) {
    if (d.applicable) applicable.push(d)
    else skipped.push(d)
  }
  return { applicable, skipped }
}

/** Human-readable skip reasons (kept here so the UI and the batch agree). */
export const SKIP_NO_HEADING = 'No matching heading found.'
export const SKIP_NO_CHANGES = 'Draft contains no changes.'

/** Per-action counts for the confirm dialog ("5 appends · 3 replaces"). */
export function actionCounts(descriptors: PatchDescriptor[]): { append: number; replace: number } {
  let append = 0
  let replace = 0
  for (const d of descriptors) {
    if (d.action === 'replace') replace += 1
    else append += 1
  }
  return { append, replace }
}
