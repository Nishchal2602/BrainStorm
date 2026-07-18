import type { ModelId, SourceRef, TokenUsage } from '@/lib/types'
import { createClaudeClient } from '@/lib/claude/client'
import type { ClaudeClient } from '@/lib/claude/types'
import { parseJsonObject } from '@/lib/features/parse'

export interface StructuredRequest {
  system: string
  /** The content the model reasons over (document, serialized findings, …). */
  user: string
  /** JSON Schema the response must conform to. */
  schema: object
  maxTokens: number
  /** Label for logging/debugging. */
  label?: string
  meta?: { clientId?: string }
}

export interface TextRequest {
  system: string
  user: string
  maxTokens: number
  webSearch?: { maxUses: number }
  label?: string
  meta?: { clientId?: string }
}

/**
 * Dependency-injection seam between the agent framework and the concrete LLM
 * transport. Lets the analyzer/synthesizer/agents be tested with a fake and
 * keeps them decoupled from createClaudeClient.
 */
export interface LlmPort {
  generateStructured<T>(req: StructuredRequest): Promise<{ data: T; usage?: TokenUsage }>
  generateText(req: TextRequest): Promise<{ text: string; sources: SourceRef[]; usage?: TokenUsage }>
}

function sumUsage(a?: TokenUsage, b?: TokenUsage): TokenUsage | undefined {
  if (!a) return b
  if (!b) return a
  return {
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
    thoughtsTokens: (a.thoughtsTokens ?? 0) + (b.thoughtsTokens ?? 0),
    totalTokens: (a.totalTokens ?? 0) + (b.totalTokens ?? 0),
  }
}

/** LlmPort backed by the existing ClaudeClient (Gemini / Anthropic / proxy). */
export class ClaudeLlmAdapter implements LlmPort {
  private readonly client: ClaudeClient

  constructor(model: ModelId, apiKey?: string, client?: ClaudeClient) {
    this.client = client ?? createClaudeClient(model, apiKey)
  }

  async generateStructured<T>(req: StructuredRequest): Promise<{ data: T; usage?: TokenUsage }> {
    const gen = await this.client.generate({
      system: req.system,
      pageText: req.user,
      taskText: '',
      jsonSchema: req.schema,
      maxTokens: req.maxTokens,
      meta: req.meta,
    })
    try {
      return { data: parseJsonObject<T>(gen.text), usage: gen.usage }
    } catch {
      // One cheap repair pass — smaller models (e.g. Haiku) sometimes emit
      // malformed/truncated JSON that is recoverable. Re-run through the same
      // schema asking for corrected JSON only; if THIS also fails, rethrow so the
      // caller decides (analyzer → DEFAULT, synthesis → run fails).
      const repaired = await this.client.generate({
        system:
          'You repair malformed or truncated JSON. Output ONLY a single valid JSON value matching the requested schema — no prose, no markdown, no code fences.',
        pageText: gen.text,
        taskText: '',
        jsonSchema: req.schema,
        maxTokens: req.maxTokens,
        meta: req.meta,
      })
      return { data: parseJsonObject<T>(repaired.text), usage: sumUsage(gen.usage, repaired.usage) }
    }
  }

  async generateText(
    req: TextRequest,
  ): Promise<{ text: string; sources: SourceRef[]; usage?: TokenUsage }> {
    const gen = await this.client.generate({
      system: req.system,
      pageText: req.user,
      taskText: '',
      webSearch: req.webSearch,
      cache: req.webSearch != null,
      maxTokens: req.maxTokens,
      meta: req.meta,
    })
    return { text: gen.text, sources: gen.sources, usage: gen.usage }
  }
}
