import type { ModelId, SourceRef, TokenUsage } from '@/lib/types'
import type { ClaudeClient, GenerateParams, GenerateResult } from './types'

export const ANTHROPIC_DIRECT_URL = 'https://api.anthropic.com/v1/messages'
export const ANTHROPIC_VERSION = '2023-06-01'
const WEB_SEARCH_TOOL = 'web_search_20260209'
const MAX_PAUSE_CONTINUATIONS = 4

interface ContentBlock {
  type: string
  text?: string
  content?: unknown
  [k: string]: unknown
}
interface MessagesResponse {
  content?: ContentBlock[]
  stop_reason?: string
  stop_details?: { explanation?: string }
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
}

/** Error carrying the API/proxy error `type` (e.g. 'demo_allowance_exhausted'). */
export class ApiError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

/**
 * Shared request/response logic for all transports. Subclasses provide the
 * endpoint + auth headers; everything else (caching, pause_turn, refusal,
 * source extraction) lives here so Direct and Proxy clients stay in sync.
 */
export abstract class BaseClaudeClient implements ClaudeClient {
  constructor(protected readonly model: ModelId) {}

  protected abstract endpoint(): string
  protected abstract authHeaders(): Record<string, string>
  /** Per-request headers derived from params (e.g. proxy rate-limit metadata). */
  protected extraHeaders(_params: GenerateParams): Record<string, string> {
    return {}
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'content-type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
      ...this.authHeaders(),
      ...extra,
    }
  }

  protected async post(body: unknown, extra: Record<string, string> = {}): Promise<MessagesResponse> {
    let res: Response
    try {
      res = await fetch(this.endpoint(), {
        method: 'POST',
        headers: this.headers(extra),
        body: JSON.stringify(body),
      })
    } catch {
      throw new Error('Network error reaching the API. Check your connection.')
    }
    if (!res.ok) {
      let detail = ''
      let code: string | undefined
      try {
        const j = (await res.json()) as { error?: { message?: string; type?: string } }
        detail = j.error?.message ?? ''
        code = j.error?.type
      } catch {
        /* ignore */
      }
      if (res.status === 401) throw new ApiError(detail || 'Unauthorized.', code)
      if (res.status === 429) throw new ApiError(detail || 'Rate limited. Try again shortly.', code)
      throw new ApiError(`API error (${res.status})${detail ? `: ${detail}` : ''}.`, code)
    }
    return (await res.json()) as MessagesResponse
  }

  async validate(): Promise<void> {
    await this.post({
      model: this.model,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'ping' }],
    })
  }

  async generate(params: GenerateParams): Promise<GenerateResult> {
    if (params.jsonSchema && params.webSearch) {
      throw new Error('jsonSchema and webSearch cannot be used together.')
    }
    const ephemeral = { type: 'ephemeral' } as const
    const cache = params.cache === true

    const base: Record<string, unknown> = {
      model: this.model,
      max_tokens: params.maxTokens,
      // Cache the stable, instruction-heavy system prefix only when reuse is
      // likely; caching a one-shot call would just pay the cache-write premium.
      system: cache
        ? [{ type: 'text', text: params.system, cache_control: ephemeral }]
        : params.system,
    }
    if (params.jsonSchema) {
      base.output_config = { format: { type: 'json_schema', schema: params.jsonSchema } }
    }
    if (params.webSearch) {
      // Server-side web search (GA tool version 2026-02-09): type + name, with an
      // optional max_uses cap. No beta header required.
      base.tools = [
        { type: WEB_SEARCH_TOOL, name: 'web_search', max_uses: params.webSearch.maxUses },
      ]
    }

    // Page content is its own block (cached for re-use by pause_turn
    // continuations); the variable task text trails it, uncached.
    const pageBlock: Record<string, unknown> = { type: 'text', text: params.pageText }
    if (cache) pageBlock.cache_control = ephemeral
    const firstUserContent: Array<Record<string, unknown>> = []
    // The per-call context block leads the turn (frames the document). It is
    // left uncached and precedes the cached page block, which reduces cache
    // reuse on this (fallback) Anthropic path — acceptable; Gemini is active.
    if (params.contextBlock) firstUserContent.push({ type: 'text', text: params.contextBlock })
    firstUserContent.push(pageBlock, { type: 'text', text: params.taskText })
    const messages: Array<{ role: string; content: unknown }> = [
      { role: 'user', content: firstUserContent },
    ]

    let text = ''
    const sources: SourceRef[] = []
    const seen = new Set<string>()
    const extra = this.extraHeaders(params)
    let inTok = 0
    let outTok = 0
    let sawUsage = false

    for (let i = 0; i <= MAX_PAUSE_CONTINUATIONS; i++) {
      const data = await this.post({ ...base, messages }, extra)
      const blocks = data.content ?? []
      if (data.usage) {
        sawUsage = true
        // Full input for a request includes cached tokens (PM Review caches the
        // system + page blocks; input_tokens alone excludes them). Continuations
        // re-send a growing context, so the largest request best represents the
        // total context size (max); output is summed across turns.
        const reqIn =
          (data.usage.input_tokens ?? 0) +
          (data.usage.cache_read_input_tokens ?? 0) +
          (data.usage.cache_creation_input_tokens ?? 0)
        inTok = Math.max(inTok, reqIn)
        outTok += data.usage.output_tokens ?? 0
      }

      for (const b of blocks) {
        if (b.type === 'text' && typeof b.text === 'string') {
          text += b.text
        } else if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
          for (const r of b.content as Array<Record<string, unknown>>) {
            const url = typeof r.url === 'string' ? r.url : ''
            if (url && !seen.has(url)) {
              seen.add(url)
              sources.push({ url, title: typeof r.title === 'string' ? r.title : undefined })
            }
          }
        }
      }

      if (data.stop_reason === 'refusal') {
        throw new Error(
          'The model declined this request' +
            (data.stop_details?.explanation ? `: ${data.stop_details.explanation}` : '.'),
        )
      }

      if (data.stop_reason === 'pause_turn' && i < MAX_PAUSE_CONTINUATIONS) {
        messages.push({ role: 'assistant', content: blocks })
        continue
      }
      break
    }

    const usage: TokenUsage | undefined = sawUsage
      ? { inputTokens: inTok, outputTokens: outTok, totalTokens: inTok + outTok }
      : undefined

    return { text: text.trim(), sources, usage }
  }
}
