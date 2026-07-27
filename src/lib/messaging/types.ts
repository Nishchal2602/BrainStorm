import type { DetectedSource, FeatureId, ResultDoc, ReviewContext } from '@/lib/types'
import type { ResolvedTarget } from '@/lib/navigation'
import type { PatchAnchor, ReadinessIssue, SuggestedPatch } from '@/lib/features/pmReview'
import type { ApplyResult } from '@/lib/editor/types'

/** Lightweight page info for the "Detected: …" badge (no Claude call). */
export interface PageInfo {
  url: string
  title: string
  source: DetectedSource
}

/** Regenerate ONE issue's AI Draft (the Retry button) without rerunning the review. */
export interface GeneratePatchRequest {
  type: 'GENERATE_PATCH'
  tabId: number
  /** The already-known issue — only the patch is regenerated. */
  issue: Pick<ReadinessIssue, 'title' | 'where' | 'why' | 'impact' | 'fix'>
  /** Stable id the new patch must carry (severity-index, same as parse-time). */
  patchId: string
  /** URL the review ran on — the patch must be generated from the same document. */
  reviewUrl?: string
}

/** Apply ONE (possibly user-edited) AI Draft to the live document via the DOM. */
export interface ApplyPatchRequest {
  type: 'APPLY_PATCH'
  tabId: number
  action: 'append' | 'replace'
  /** Locally-derived anchor (sectionHash rides inside it). */
  anchor: PatchAnchor
  /** The edited draft text to apply — never the original patch.content. */
  body: string
  /** URL the review ran on — the patch must be applied to the same document. */
  reviewUrl?: string
}

export type Request =
  | { type: 'GET_PAGE_INFO'; tabId: number }
  | { type: 'RUN_FEATURE'; tabId: number; featureId: FeatureId; reviewContext?: ReviewContext }
  | { type: 'RUN_DEEP_REVIEW'; tabId: number; reviewContext?: ReviewContext }
  | { type: 'VALIDATE_KEY'; apiKey: string }
  | { type: 'JUMP_TO_REFERENCE'; tabId: number; target: ResolvedTarget }
  | ApplyPatchRequest
  | GeneratePatchRequest
  // Notion OAuth: exchange the auth code (SW → Worker proxy) + report connection state.
  | { type: 'EXCHANGE_NOTION_CODE'; code: string; redirectUri: string }
  | { type: 'NOTION_STATUS' }

export type Ok<T> = { ok: true; data: T }
export type Err = { ok: false; error: string; code?: string }
export type Reply<T> = Ok<T> | Err

export type ReplyFor<R extends Request> = R extends { type: 'GET_PAGE_INFO' }
  ? Reply<PageInfo>
  : R extends { type: 'RUN_FEATURE' }
    ? Reply<ResultDoc>
    : R extends { type: 'RUN_DEEP_REVIEW' }
      ? Reply<ResultDoc>
      : R extends { type: 'VALIDATE_KEY' }
        ? Reply<{ valid: true }>
        : R extends { type: 'JUMP_TO_REFERENCE' }
          ? Reply<{ found: boolean }>
          : R extends { type: 'APPLY_PATCH' }
            ? Reply<ApplyResult>
            : R extends { type: 'GENERATE_PATCH' }
              ? Reply<{ patch: SuggestedPatch }>
              : R extends { type: 'EXCHANGE_NOTION_CODE' }
                ? Reply<{ workspaceName?: string }>
                : R extends { type: 'NOTION_STATUS' }
                  ? Reply<{ connected: boolean; workspaceName?: string }>
                  : never

/** Typed wrapper around chrome.runtime.sendMessage. */
export function sendMessage<R extends Request>(req: R): Promise<ReplyFor<R>> {
  return chrome.runtime.sendMessage(req) as Promise<ReplyFor<R>>
}
