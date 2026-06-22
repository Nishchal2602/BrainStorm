import type { HistoryEntry } from '@/lib/types'

const KEY = 'pm_history'
const MAX_ENTRIES = 50

export async function listHistory(): Promise<HistoryEntry[]> {
  const obj = await chrome.storage.local.get(KEY)
  return (obj[KEY] as HistoryEntry[] | undefined) ?? []
}

export async function addHistory(entry: HistoryEntry): Promise<void> {
  const all = await listHistory()
  const next = [entry, ...all].slice(0, MAX_ENTRIES)
  await chrome.storage.local.set({ [KEY]: next })
}

export async function getHistory(id: string): Promise<HistoryEntry | undefined> {
  return (await listHistory()).find((e) => e.id === id)
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.set({ [KEY]: [] })
}

/** Stable-enough id for a history entry (extension runtime — Date.now is fine here). */
export function newHistoryId(): string {
  return `h_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
