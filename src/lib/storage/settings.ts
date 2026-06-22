import type { Settings } from '@/lib/types'

const KEY = 'pm_settings'

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: 'auto', // per-feature recommended model (Haiku for structured, Sonnet for PM Review)
  mode: 'pm',
  researchDepth: 'quick', // bounds PM Review web_search cost for the $5 demo budget
  demoMode: false,
}

const VALID_MODES = ['pm', 'founder', 'product_analyst']

export async function getSettings(): Promise<Settings> {
  const obj = await chrome.storage.local.get(KEY)
  const merged = { ...DEFAULT_SETTINGS, ...(obj[KEY] as Partial<Settings> | undefined) }
  // Coerce any retired/unknown mode (e.g. legacy 'product_ops') to the default.
  if (!VALID_MODES.includes(merged.mode)) merged.mode = 'pm'
  return merged
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch }
  await chrome.storage.local.set({ [KEY]: next })
  return next
}

export function onSettingsChanged(cb: (settings: Settings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area === 'local' && changes[KEY]) {
      cb({ ...DEFAULT_SETTINGS, ...(changes[KEY].newValue as Partial<Settings>) })
    }
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}
