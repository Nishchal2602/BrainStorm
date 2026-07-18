import type { ModelId, SourceRef, TokenUsage } from '@/lib/types'
import type { ClaudeClient, GenerateParams, GenerateResult } from './types'

export const ANTHROPIC_DIRECT_URL = 'https://api.anthropic.com/v1/messages'
export const ANTHROPIC_VERSION = '2023-06-01'
const WEB_SEARCH_TOOL = 'web_search_20260209'
const MAX_PAUSE_CONTINUATIONS = 4

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Retry policy. 429 (rate limit) honors the server's `retry-after`, else a
// moderate backoff. 503/529 (overloaded) and transient network errors clear
// quickly, so they retry fast. Waits are capped at MAX_BACKOFF_MS.
const RETRY_STATUS = new Set([429, 503, 529])
const MAX_ATTEMPTS = 3
const RATE_LIMIT_BACKOFF_MS = [2000, 6000] // 429 with no retry-after hint
const TRANSIENT_BACKOFF_MS = [250, 750] // 503/529/network — brief blips
const MAX_BACKOFF_MS = 30_000

/** How long to wait before retrying. 429 prefers the server's `retry-after`
 * (seconds) then a moderate backoff; 503/529/network use a fast backoff.
 * `status === 0` denotes a network/timeout error (no response). */
function retryWaitMs(attempt: number, status: number, res?: Response): number {
  if (status === 429) {
    const header = res ? Number(res.headers.get('retry-after')) : NaN
    if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, MAX_BACKOFF_MS)
    return RATE_LIMIT_BACKOFF_MS[Math.min(attempt, RATE_LIMIT_BACKOFF_MS.length - 1)]
  }
  return TRANSIENT_BACKOFF_MS[Math.min(attempt, TRANSIENT_BACKOFF_MS.length - 1)]
}

// Anthropic's structured output (output_config.format) requires additionalProperties:false
// on every object and rejects the numeric/length/pattern keywords that Gemini's
// responseSchema tolerates. The shared schemas are written Gemini-first (see the
// analyzer/synthesis/customerVoice comments), so adapt them here at the transport
// rather than forking the schema definitions.
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties',
])

/** Deep-copy a JSON Schema into the shape Anthropic's json_schema output accepts:
 *  add `additionalProperties: false` to every object node, drop unsupported keywords. */
function toAnthropicSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toAnthropicSchema)
  if (!node || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(k)) continue
    if (k === 'properties' && v && typeof v === 'object') {
      out[k] = Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, toAnthropicSchema(pv)]),
      )
    } else if (['items', 'anyOf', 'allOf', 'oneOf', '$defs', 'definitions'].includes(k)) {
      out[k] = toAnthropicSchema(v)
    } else {
      out[k] = v
    }
  }
  if (out.type === 'object' || 'properties' in out) out.additionalProperties = false
  return out
}

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
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let res: Response
      try {
        res = await fetch(this.endpoint(), {
          method: 'POST',
          headers: this.headers(extra),
          body: JSON.stringify(body),
        })
      } catch {
        // Transient network/timeout blip — retry fast, then give up.
        if (attempt < MAX_ATTEMPTS - 1) {
          await sleep(retryWaitMs(attempt, 0))
          continue
        }
        throw new Error('Network error reaching the API. Check your connection.')
      }
      if (res.ok) return (await res.json()) as MessagesResponse

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
      // Rate-limited (429) / overloaded (503/529): wait it out (honoring the
      // server's retry-after hint) and retry before giving up.
      if (RETRY_STATUS.has(res.status) && attempt < MAX_ATTEMPTS - 1) {
        await sleep(retryWaitMs(attempt, res.status, res))
        continue
      }
      if (res.status === 429) throw new ApiError(detail || 'Rate limited. Try again shortly.', code)
      throw new ApiError(`API error (${res.status})${detail ? `: ${detail}` : ''}.`, code)
    }
    // Unreachable: the loop returns on success or throws on the final attempt.
    throw new ApiError('Rate limited. Try again shortly.')
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
      base.output_config = { format: { type: 'json_schema', schema: toAnthropicSchema(params.jsonSchema) } }
    }
    if (params.webSearch) {
      // Server-side web search (GA tool version 2026-02-09): type + name, with an
      // optional max_uses cap. `allowed_callers: ['direct']` keeps it a plain
      // direct-call tool — the default dynamic-filtering path runs via programmatic
      // tool calling (code execution), which smaller models (e.g. Haiku 4.5) reject
      // with a 400. No beta header required.
      base.tools = [
        {
          type: WEB_SEARCH_TOOL,
          name: 'web_search',
          max_uses: params.webSearch.maxUses,
          allowed_callers: ['direct'],
        },
      ]
    }

    // Build the user turn from the non-empty parts only — Anthropic rejects empty
    // text blocks, and the adapter passes taskText: '' for every call. The context
    // block leads the turn (frames the document); the page block trails it and
    // carries the cache breakpoint (re-used by pause_turn continuations) when
    // caching is on. Leaving the context block uncached before the cached page
    // block reduces cache reuse on this Anthropic path — acceptable.
    const firstUserContent: Array<Record<string, unknown>> = []
    if (params.contextBlock) firstUserContent.push({ type: 'text', text: params.contextBlock })
    if (params.pageText) {
      const pageBlock: Record<string, unknown> = { type: 'text', text: params.pageText }
      if (cache) pageBlock.cache_control = ephemeral
      firstUserContent.push(pageBlock)
    }
    if (params.taskText) firstUserContent.push({ type: 'text', text: params.taskText })
    if (firstUserContent.length === 0) firstUserContent.push({ type: 'text', text: '(no content)' })
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
