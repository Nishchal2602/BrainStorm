import { newId, type FeedbackEvent, ANALYTICS_SCHEMA_VERSION } from '@/lib/analytics'

// Immutable, append-only feedback/interaction event log. Every 👍/👎 (and, later,
// expand/copy/dismiss) is a new event — never an overwrite — so quality signals
// can be analyzed over time. Best-effort, never throws.

const KEY = 'pm_feedback_events'
const MAX_ENTRIES = 1000

export async function listFeedbackEvents(): Promise<FeedbackEvent[]> {
  try {
    const obj = await chrome.storage.local.get(KEY)
    return (obj[KEY] as FeedbackEvent[] | undefined) ?? []
  } catch {
    return []
  }
}

/** Append one feedback event (id + timestamp + schemaVersion filled here). */
export async function recordFeedbackEvent(
  event: Omit<FeedbackEvent, 'feedbackId' | 'timestamp' | 'schemaVersion'>,
): Promise<void> {
  try {
    const list = await listFeedbackEvents()
    const full: FeedbackEvent = {
      ...event,
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      feedbackId: newId('fb'),
      timestamp: Date.now(),
    }
    const next = [full, ...list].slice(0, MAX_ENTRIES)
    await chrome.storage.local.set({ [KEY]: next })
  } catch {
    /* storage unavailable — drop the event */
  }
}
