import type { TokenUsage } from './types'

/** Total tokens for a run — prefers the provider's total, else input+output. */
export function tokenTotal(u: TokenUsage): number {
  return u.totalTokens ?? (u.inputTokens ?? 0) + (u.outputTokens ?? 0)
}

/**
 * Full label, e.g. "~1,234 tokens (900 in / 334 out)" — for the result view.
 * Includes a "think" part when thinking tokens are present so the breakdown
 * reconciles with the headline total (which counts them).
 */
export function formatTokens(u: TokenUsage): string {
  const parts: string[] = []
  if (u.inputTokens != null) parts.push(`${u.inputTokens.toLocaleString()} in`)
  if (u.outputTokens != null) parts.push(`${u.outputTokens.toLocaleString()} out`)
  if (u.thoughtsTokens) parts.push(`${u.thoughtsTokens.toLocaleString()} think`)
  const breakdown = parts.length ? ` (${parts.join(' / ')})` : ''
  return `~${tokenTotal(u).toLocaleString()} tokens${breakdown}`
}
