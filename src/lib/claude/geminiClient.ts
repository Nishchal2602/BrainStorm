import type { SourceRef, TokenUsage } from '@/lib/types'
import { config } from '@/lib/config'
import { ApiError } from './base'
import type { ClaudeClient, GenerateParams, GenerateResult } from './types'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Research Depth → grounding thoroughness. Gemini's Google Search grounding has
 * no explicit per-call search budget (unlike Claude's web_search `max_uses`), so
 * depth is expressed as an instruction; the token budget also scales by depth
 * (see FeatureDef.maxTokens).
 */
const DEPTH_HINT: Record<string, string> = {
  quick: 'Research scope: focused — run a few high-signal searches and prioritize the most authoritative sources.',
  standard: 'Research scope: balanced — search several angles and corroborate the key claims.',
  deep: 'Research scope: exhaustive — search broadly across many angles and dig for primary/authoritative sources.',
}

interface GeminiPart {
  text?: string
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[] }
  finishReason?: string
  groundingMetadata?: {
    groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>
  }
}
interface GeminiResponse {
  candidates?: GeminiCandidate[]
  promptFeedback?: { blockReason?: string }
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    thoughtsTokenCount?: number
    totalTokenCount?: number
  }
}

/**
 * Google Gemini transport (MVP/validation). Implements the same ClaudeClient
 * seam so the rest of the app is unchanged: it maps GenerateParams onto Gemini's
 * generateContent API, uses Google Search grounding where the feature asked for
 * web_search, and returns the same { text, sources } shape the parsers expect.
 *
 * The Anthropic ModelId from the feature is ignored — every call uses
 * config.geminiModel.
 */
export class GeminiClient implements ClaudeClient {
  private readonly model = config.geminiModel
  private readonly apiKey: string

  /** Runtime key (pasted in the UI as BYOK) overrides the build-time config key. */
  constructor(apiKey?: string) {
    this.apiKey = apiKey?.trim() || config.geminiApiKey
  }

  private endpoint(): string {
    return `${GEMINI_BASE}/${this.model}:generateContent`
  }

  private async post(body: unknown): Promise<GeminiResponse> {
    let res: Response
    try {
      res = await fetch(this.endpoint(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
      })
    } catch {
      throw new Error('Network error reaching the Gemini API. Check your connection.')
    }
    if (!res.ok) {
      let detail = ''
      try {
        const j = (await res.json()) as { error?: { message?: string; status?: string } }
        detail = j.error?.message ?? ''
      } catch {
        /* ignore */
      }
      if (res.status === 401 || res.status === 403)
        throw new ApiError(detail || 'Invalid Gemini API key.')
      if (res.status === 429)
        throw new ApiError(detail || 'Gemini rate limit reached. Try again shortly.')
      throw new ApiError(`Gemini API error (${res.status})${detail ? `: ${detail}` : ''}.`)
    }
    return (await res.json()) as GeminiResponse
  }

  /** Disable "thinking" on 2.5 Flash models so output tokens aren't starved
   * (keeps PM Review complete and fast). Only Flash/Flash-Lite accept a 0 budget —
   * Pro requires a minimum, and 2.0 has no thinking — so guard narrowly. */
  private generationConfig(maxTokens: number): Record<string, unknown> {
    const cfg: Record<string, unknown> = { maxOutputTokens: maxTokens }
    if (this.model.includes('2.5') && this.model.includes('flash')) {
      cfg.thinkingConfig = { thinkingBudget: 0 }
    }
    return cfg
  }

  async validate(): Promise<void> {
    // Disable thinking (via generationConfig) so the tiny probe returns real text
    // instead of being starved by 2.5 Flash's default thinking budget.
    await this.post({
      contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
      generationConfig: this.generationConfig(16),
    })
  }

  async generate(params: GenerateParams): Promise<GenerateResult> {
    const depth = params.meta?.depth
    const groundingHint = params.webSearch && depth ? `\n\n${DEPTH_HINT[depth] ?? ''}` : ''

    // Context block (user profile + review context) leads the user turn so it
    // frames the document that follows.
    const userParts: Array<{ text: string }> = []
    if (params.contextBlock) userParts.push({ text: params.contextBlock })
    userParts.push({ text: params.pageText })
    userParts.push({ text: params.taskText + groundingHint })

    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: params.system }] },
      contents: [{ role: 'user', parts: userParts }],
      generationConfig: this.generationConfig(params.maxTokens),
    }

    if (params.webSearch) {
      // Google Search grounding — Gemini's equivalent of Claude's web_search tool.
      body.tools = [{ google_search: {} }]
    } else if (params.jsonSchema) {
      // Structured output for the (currently coming-soon) features. Grounding and
      // responseSchema are mutually exclusive in Gemini — same constraint as Claude.
      // Note: Gemini accepts a subset of JSON Schema; the coming-soon schemas may
      // need light adjustment when those features are switched on.
      const gc = body.generationConfig as Record<string, unknown>
      gc.responseMimeType = 'application/json'
      gc.responseSchema = params.jsonSchema
    }

    const data = await this.post(body)
    const cand = data.candidates?.[0]
    if (!cand) {
      const reason = data.promptFeedback?.blockReason
      throw new Error(
        reason ? `Gemini blocked the request (${reason}).` : 'Gemini returned no response.',
      )
    }

    const text = (cand.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim()

    const sources: SourceRef[] = []
    const seen = new Set<string>()
    for (const chunk of cand.groundingMetadata?.groundingChunks ?? []) {
      const url = chunk.web?.uri
      if (url && !seen.has(url)) {
        seen.add(url)
        sources.push({ url, title: chunk.web?.title })
      }
    }

    const m = data.usageMetadata
    const usage: TokenUsage | undefined = m
      ? {
          inputTokens: m.promptTokenCount,
          outputTokens: m.candidatesTokenCount,
          thoughtsTokens: m.thoughtsTokenCount,
          totalTokens: m.totalTokenCount,
        }
      : undefined

    return { text, sources, usage }
  }
}
