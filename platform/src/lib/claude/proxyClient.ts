import type { ModelId } from '@/lib/types'
import { BaseClaudeClient } from './base'
import type { GenerateParams } from './types'
import { config } from '@/lib/config'

/**
 * Owner-key transport — calls the Cloudflare Worker proxy, which holds the
 * Anthropic key server-side. The extension sends only the shared secret; the
 * proxy enforces daily caps and forwards to Anthropic. No per-user key needed.
 */
export class ProxyClaudeClient extends BaseClaudeClient {
  constructor(model: ModelId) {
    super(model)
  }
  protected endpoint(): string {
    return config.proxyUrl
  }
  protected authHeaders(): Record<string, string> {
    return { 'x-extension-secret': config.proxySecret }
  }
  protected extraHeaders(params: GenerateParams): Record<string, string> {
    const h: Record<string, string> = {}
    if (params.meta?.clientId) h['x-client-id'] = params.meta.clientId
    if (params.meta?.depth) h['x-pm-depth'] = params.meta.depth
    return h
  }
}
