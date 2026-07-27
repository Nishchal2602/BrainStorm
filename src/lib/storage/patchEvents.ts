import { newId, ANALYTICS_SCHEMA_VERSION } from '@/lib/analytics'

// Append-only AI Draft lifecycle event log. Three funnels:
//   generation quality — generated → opened → edited → copied (+ reset)
//   triage             — accepted / rejected / restored (+ timeToDecisionMs)
//   apply              — applied / apply_failed
// Heavy editing before copying means draft quality is too low; the accept rate is
// the single clearest signal of whether the reviews are actually good; a recurring
// apply_failed errorCode points at heading resolution or Notion permissions.
// Records METADATA only (ids + sizes + timings), never patch or PRD content.
// Same posture as feedback.ts: best-effort, capped.

export type PatchEventType =
  | 'generated'
  | 'opened'
  | 'edited'
  | 'copied'
  | 'reset'
  | 'accepted'
  | 'rejected'
  | 'restored'
  | 'applied'
  | 'apply_failed'

export interface PatchEvent {
  schemaVersion: number
  eventId: string
  timestamp: number
  type: PatchEventType
  /** Review the patch belongs to (absent for legacy results). */
  reviewId?: string
  /** Stable position-based patch id (`critical-0`, …). */
  patchId: string
  /** Content-derived finding id — joins with feedback events. */
  findingId?: string
  /** Text length at event time — a size signal, never the text itself. */
  length?: number
  /** Apply latency (ms) — 'applied' / 'apply_failed' only. */
  durationMs?: number
  /** Taxonomy code on a failed apply (e.g. HEADING_NOT_FOUND, ALREADY_APPLIED, NOTION_FORBIDDEN). */
  errorCode?: string
  /** Per-patch apply attempt counter (retryCount) — increments per click. */
  attempt?: number
  /** Winning InsertStrategy on success ('execCommand' | 'inputEvent' | 'clipboard'). */
  strategy?: string
  /** Characters the draft ADDS to the section, from the diff preview — a size signal only. */
  addedChars?: number
  /** Characters the draft REMOVES (always 0 while only append is supported). */
  removedChars?: number
  /** Did the user edit the generated draft before copying/applying it? */
  edited?: boolean
  /**
   * Milliseconds from the draft becoming available to the accept/reject/restore
   * decision. Reject is as informative as accept here — "sat for two minutes,
   * then rejected" reads very differently from "accepted instantly".
   */
  timeToDecisionMs?: number
}

const KEY = 'pm_patch_events'
const MAX_ENTRIES = 2000

export async function listPatchEvents(): Promise<PatchEvent[]> {
  try {
    const obj = await chrome.storage.local.get(KEY)
    return (obj[KEY] as PatchEvent[] | undefined) ?? []
  } catch {
    return []
  }
}

/** Append one lifecycle event (id + timestamp + schemaVersion filled here). */
export async function recordPatchEvent(
  event: Omit<PatchEvent, 'eventId' | 'timestamp' | 'schemaVersion'>,
): Promise<void> {
  try {
    const list = await listPatchEvents()
    const full: PatchEvent = {
      ...event,
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      eventId: newId('pe'),
      timestamp: Date.now(),
    }
    const next = [full, ...list].slice(0, MAX_ENTRIES)
    await chrome.storage.local.set({ [KEY]: next })
  } catch {
    /* storage unavailable — drop the event */
  }
}
