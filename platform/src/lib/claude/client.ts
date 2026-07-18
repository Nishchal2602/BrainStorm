import type { ClaudeClient } from './types'
import type { ModelId } from '@/lib/types'
import { config } from '@/lib/config'
import { ANTHROPIC_DIRECT_URL, BaseClaudeClient } from './base'
import { ProxyClaudeClient } from './proxyClient'
import { GeminiClient } from './geminiClient'

/** BYOK transport — calls Anthropic directly with the user's key (dev/fallback). */
export class DirectClaudeClient extends BaseClaudeClient {
  constructor(
    private readonly apiKey: string,
    model: ModelId,
  ) {
    super(model)
  }
  protected endpoint(): string {
    return ANTHROPIC_DIRECT_URL
  }
  protected authHeaders(): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      // Required for direct browser/extension-origin calls (BYOK).
      'anthropic-dangerous-direct-browser-access': 'true',
    }
  }
}

/**
 * Which provider a pasted key belongs to. Anthropic keys are unmistakable
 * ("sk-ant-…"), so we route those to Claude and treat EVERYTHING else as Gemini
 * (Gemini-first MVP). This is deliberately lenient: a Gemini key with stray
 * formatting still reaches Gemini (and a truly bad key fails with a clear Gemini
 * error) rather than being silently sent to Anthropic.
 */
export function isGeminiKey(key: string): boolean {
  return !/^sk-ant-/i.test(key.trim())
}

/**
 * Single source of truth for transport selection — used by BOTH the live call
 * and the "Validate & Save" probe so a key can never validate against one
 * provider and then run against another. Precedence:
 * - a pasted BYOK key wins (honor what the user explicitly entered):
 *     Anthropic key (sk-ant-…) → DirectClaudeClient · anything else → GeminiClient
 * - else build-time Anthropic key → DirectClaudeClient (owner-key, direct to Anthropic)
 * - else build-time Gemini key → GeminiClient
 * - else build-time proxy      → ProxyClaudeClient (owner-key mode)
 * - else                       → DirectClaudeClient (empty key; surfaces a clear auth error)
 */
export function createClaudeClient(model: ModelId, apiKey?: string): ClaudeClient {
  const key = apiKey?.trim()
  if (key) {
    return isGeminiKey(key) ? new GeminiClient(key) : new DirectClaudeClient(key, model)
  }
  if (config.usesAnthropic) {
    return new DirectClaudeClient(config.anthropicApiKey, config.anthropicModel as ModelId)
  }
  if (config.usesGemini) {
    return new GeminiClient()
  }
  if (config.usesProxy) {
    return new ProxyClaudeClient(model)
  }
  return new DirectClaudeClient('', model)
}
