// Locally-edited AI Draft text, keyed drafts[reviewId][patchId] so an edit
// survives panel closes and browser restarts. Only the user's EDITED text is
// stored — the generated original always lives on the SuggestedPatch itself.
// Same best-effort, capped-storage posture as the other storage modules.

const KEY = 'pm_patch_drafts'
/** Keep drafts only for the newest reviews (storage-quota guard). */
const MAX_REVIEWS = 20

interface DraftEntry {
  text: string
  ts: number
}

/** reviewId → patchId → entry. */
type DraftStore = Record<string, Record<string, DraftEntry>>

async function load(): Promise<DraftStore> {
  try {
    const obj = await chrome.storage.local.get(KEY)
    return (obj[KEY] as DraftStore | undefined) ?? {}
  } catch {
    return {}
  }
}

/** Newest edit inside a review — recency key for pruning whole reviews. */
const newestTs = (drafts: Record<string, DraftEntry>): number =>
  Math.max(0, ...Object.values(drafts).map((d) => d.ts))

export async function getDraft(reviewId: string, patchId: string): Promise<string | undefined> {
  const store = await load()
  return store[reviewId]?.[patchId]?.text
}

export async function saveDraft(reviewId: string, patchId: string, text: string): Promise<void> {
  try {
    const store = await load()
    store[reviewId] = { ...store[reviewId], [patchId]: { text, ts: Date.now() } }
    const keep = Object.entries(store)
      .sort(([, a], [, b]) => newestTs(b) - newestTs(a))
      .slice(0, MAX_REVIEWS)
    await chrome.storage.local.set({ [KEY]: Object.fromEntries(keep) })
  } catch {
    /* storage unavailable — the in-memory textarea still holds the edit */
  }
}

/** Remove one saved edit (Cancel/reset) — the UI falls back to the generated text. */
export async function clearDraft(reviewId: string, patchId: string): Promise<void> {
  try {
    const store = await load()
    if (!store[reviewId]?.[patchId]) return
    delete store[reviewId][patchId]
    if (!Object.keys(store[reviewId]).length) delete store[reviewId]
    await chrome.storage.local.set({ [KEY]: store })
  } catch {
    /* best-effort */
  }
}
