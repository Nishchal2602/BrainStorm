const KEY = 'pm_feedback'
const MAX_ENTRIES = 300

/** One 👍/👎 vote on a review item — local evaluation data for prompt tuning. */
export interface FeedbackEntry {
  /** Stable item key, e.g. "critical:0:<issue title>". */
  key: string
  vote: 'up' | 'down'
  feature: string
  url?: string
  timestamp: number
}

/** Best-effort append (newest first, capped). Never throws — feedback is optional. */
export async function recordFeedback(entry: Omit<FeedbackEntry, 'timestamp'>): Promise<void> {
  try {
    const obj = await chrome.storage.local.get(KEY)
    const list = (obj[KEY] as FeedbackEntry[] | undefined) ?? []
    const next = [{ ...entry, timestamp: Date.now() }, ...list].slice(0, MAX_ENTRIES)
    await chrome.storage.local.set({ [KEY]: next })
  } catch {
    /* storage unavailable — drop the vote */
  }
}
