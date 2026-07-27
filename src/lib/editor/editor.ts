import type { ApplyRequest, ApplyResult } from './types'

/** Everything an editor needs to apply one patch. `token` is the Notion OAuth token. */
export interface ApplyContext extends ApplyRequest {
  tabId: number
  /** Current tab URL (page-id fallback + host checks). */
  url: string
  /** Notion access token (present because the SW gated on it before dispatch). */
  token: string
}

/**
 * A site-specific document editor. Applies a resolved, validated patch to the
 * live document via that site's official API. `applyPatch` is action-driven
 * (append | replace) so the seam never needs refactoring when replace ships —
 * though NotionApiEditor currently supports append only.
 */
export interface DocumentEditor {
  canHandle(url: string): boolean
  applyPatch(ctx: ApplyContext): Promise<ApplyResult>
}
