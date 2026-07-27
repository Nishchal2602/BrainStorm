// Notion OAuth token + workspace identifiers, persisted in chrome.storage.local.
// Best-effort (same posture as settings.ts): reads never throw. The identifiers
// (workspaceId / botId) are stored alongside the token so future disconnect/
// reconnect and multi-workspace support stay clean.

const KEY = 'pm_notion_auth'

export interface NotionAuth {
  /** OAuth access token (long-lived; Notion doesn't issue refresh tokens today). */
  accessToken: string
  workspaceId?: string
  workspaceName?: string
  workspaceIcon?: string
  botId?: string
  connectedAt: number
}

export async function getNotionAuth(): Promise<NotionAuth | null> {
  try {
    const obj = await chrome.storage.local.get(KEY)
    const v = obj[KEY] as NotionAuth | undefined
    return v && v.accessToken ? v : null
  } catch {
    return null
  }
}

export async function setNotionAuth(v: NotionAuth): Promise<void> {
  try {
    await chrome.storage.local.set({ [KEY]: v })
  } catch {
    /* storage unavailable — the connect flow surfaces the failure */
  }
}

export async function clearNotionAuth(): Promise<void> {
  try {
    await chrome.storage.local.remove(KEY)
  } catch {
    /* ignore */
  }
}

export async function isNotionConnected(): Promise<boolean> {
  return (await getNotionAuth()) !== null
}
