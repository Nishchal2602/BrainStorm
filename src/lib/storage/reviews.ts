import type { ReviewRecord } from '@/lib/analytics'

// Event-sourced review records (one per review run) — the analytics table.
// Same capped-list pattern as history.ts; best-effort, never throws.

const KEY = 'pm_reviews'
const MAX_RECORDS = 100
/** Keep bulky raw agent outputs only on the newest reviews (storage-quota guard). */
const RAW_KEEP = 25

export async function listReviewRecords(): Promise<ReviewRecord[]> {
  try {
    const obj = await chrome.storage.local.get(KEY)
    return (obj[KEY] as ReviewRecord[] | undefined) ?? []
  } catch {
    return []
  }
}

/** Prepend a review record, cap the list, and drop rawOutputs beyond the newest RAW_KEEP. */
export async function addReviewRecord(record: ReviewRecord): Promise<void> {
  try {
    const all = await listReviewRecords()
    const next = [record, ...all].slice(0, MAX_RECORDS).map((r, i) =>
      i < RAW_KEEP ? r : r.rawOutputs ? { ...r, rawOutputs: undefined } : r,
    )
    await chrome.storage.local.set({ [KEY]: next })
  } catch {
    /* storage unavailable — analytics capture is best-effort */
  }
}
