const KEY = 'pm_client_id'

/**
 * A stable per-install id used as the proxy's per-user rate-limit key. Created
 * once and persisted in chrome.storage.local.
 *
 * Note: clearing the extension's storage yields a fresh id (and a fresh demo
 * allowance) — acceptable because the proxy's global daily cap is the hard
 * spend backstop.
 */
export async function getClientId(): Promise<string> {
  const obj = await chrome.storage.local.get(KEY)
  const existing = obj[KEY] as string | undefined
  if (existing) return existing
  const id = crypto.randomUUID()
  await chrome.storage.local.set({ [KEY]: id })
  return id
}

const EXHAUSTED_KEY = 'pm_allowance_exhausted'

/** Whether this user has used up their free PM Review allowance (persisted). */
export async function getAllowanceExhausted(): Promise<boolean> {
  const obj = await chrome.storage.local.get(EXHAUSTED_KEY)
  return Boolean(obj[EXHAUSTED_KEY])
}

export async function setAllowanceExhausted(value: boolean): Promise<void> {
  await chrome.storage.local.set({ [EXHAUSTED_KEY]: value })
}
