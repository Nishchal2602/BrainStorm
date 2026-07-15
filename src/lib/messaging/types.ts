import type { DetectedSource, FeatureId, ResultDoc, ReviewContext } from '@/lib/types'
import type { ResolvedTarget } from '@/lib/navigation'

/** Lightweight page info for the "Detected: …" badge (no Claude call). */
export interface PageInfo {
  url: string
  title: string
  source: DetectedSource
}

export type Request =
  | { type: 'GET_PAGE_INFO'; tabId: number }
  | { type: 'RUN_FEATURE'; tabId: number; featureId: FeatureId; reviewContext?: ReviewContext }
  | { type: 'RUN_DEEP_REVIEW'; tabId: number; reviewContext?: ReviewContext }
  | { type: 'VALIDATE_KEY'; apiKey: string }
  | { type: 'JUMP_TO_REFERENCE'; tabId: number; target: ResolvedTarget }

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
          : never

/** Typed wrapper around chrome.runtime.sendMessage. */
export function sendMessage<R extends Request>(req: R): Promise<ReplyFor<R>> {
  return chrome.runtime.sendMessage(req) as Promise<ReplyFor<R>>
}
