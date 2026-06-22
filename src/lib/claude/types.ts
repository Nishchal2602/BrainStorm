import type { ResearchDepth, SourceRef, TokenUsage } from '@/lib/types'

export type { TokenUsage }

export interface GenerateParams {
  /** Stable, high-quality instructions — sent as a cached system block. */
  system: string
  /** The captured page content — sent as a separate cached block (helps re-runs and pause_turn continuations). */
  pageText: string
  /** Feature task + any per-call instructions — the uncached, variable tail. */
  taskText: string
  /** Optional user/review context block, injected BEFORE the page/document. */
  contextBlock?: string
  maxTokens: number
  /** When set, forces structured JSON output via output_config.format. */
  jsonSchema?: object
  /** When set, enables the server-side web_search tool. Mutually exclusive with jsonSchema. */
  webSearch?: { maxUses: number }
  /**
   * Apply prompt caching (cache_control) to the system + page blocks. Only worth
   * it when reuse is likely (e.g. PM Review's pause_turn continuations) — caching
   * a one-shot call just pays the cache-write premium.
   */
  cache?: boolean
  /** Per-user metadata for proxy-side rate limiting (proxy mode only). */
  meta?: { clientId?: string; depth?: ResearchDepth }
}

export interface GenerateResult {
  /** Concatenated text content blocks from the response. */
  text: string
  /** Web-search sources surfaced during the call (deduped). */
  sources: SourceRef[]
  /** Token usage reported by the provider, if available. */
  usage?: TokenUsage
}

export interface ClaudeClient {
  generate(params: GenerateParams): Promise<GenerateResult>
  /** Throws on an invalid key / unreachable endpoint. */
  validate(): Promise<void>
}
