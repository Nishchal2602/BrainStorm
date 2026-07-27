import { config } from '@/lib/config'
import { sendMessage } from '@/lib/messaging/types'

// Notion OAuth connect flow (runs in the side panel — chrome.identity needs an
// extension context + user gesture). We only obtain the auth CODE here; the
// secret code→token exchange happens in the service worker via the Worker proxy
// (which holds the client_secret). The token is never handled in the UI.

const NOTION_AUTHORIZE_URL = 'https://api.notion.com/v1/oauth/authorize'

/** Redirect URI Chrome hands OAuth results to — must be registered in the Notion integration. */
export function notionRedirectUri(): string {
  return chrome.identity.getRedirectURL('notion')
}

/**
 * Launch the Notion consent screen, capture the auth code, and hand it to the SW
 * for exchange + storage. Returns the connected workspace name on success.
 * Throws with a user-facing message on cancel / mismatch / exchange failure.
 */
export async function connectNotion(): Promise<{ workspaceName?: string }> {
  if (!config.notionOAuthConfigured) {
    throw new Error('Notion connection is not configured in this build.')
  }
  const redirectUri = notionRedirectUri()
  const state = crypto.randomUUID()
  const authUrl =
    `${NOTION_AUTHORIZE_URL}?client_id=${encodeURIComponent(config.notionClientId)}` +
    `&response_type=code&owner=user` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`

  const redirect = await launchAuthFlow(authUrl)

  let params: URLSearchParams
  try {
    params = new URL(redirect).searchParams
  } catch {
    throw new Error('Notion returned an unexpected response. Try again.')
  }
  const err = params.get('error')
  if (err) throw new Error(err === 'access_denied' ? 'Connection cancelled.' : `Notion error: ${err}`)
  if (params.get('state') !== state) throw new Error('Security check failed — please try connecting again.')
  const code = params.get('code')
  if (!code) throw new Error('No authorization code returned. Try again.')

  const res = await sendMessage({ type: 'EXCHANGE_NOTION_CODE', code, redirectUri })
  if (!res.ok) throw new Error(res.error || 'Could not connect to Notion.')
  return { workspaceName: res.data.workspaceName }
}

/** Promise wrapper around launchWebAuthFlow (callback API), mapping cancel → a clean error. */
function launchAuthFlow(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirect) => {
      const lastErr = chrome.runtime.lastError
      if (lastErr || !redirect) {
        reject(new Error(lastErr?.message ?? 'Connection cancelled.'))
        return
      }
      resolve(redirect)
    })
  })
}
