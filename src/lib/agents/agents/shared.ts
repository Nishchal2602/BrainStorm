import type { ReviewContext } from '@/lib/types'
import type { AgentContext, Classification } from '../types'

/** The classifier's output, stashed on the context by the orchestrator. */
export function getClassification(ctx: AgentContext): Classification | undefined {
  return ctx.metadata?.classification as Classification | undefined
}

/** The per-review context (feature/problem/reviewType/…), if provided. */
export function getReviewContext(ctx: AgentContext): ReviewContext | undefined {
  return ctx.metadata?.reviewContext as ReviewContext | undefined
}

const REGULATED = /fintech|finance|financial|bank|payment|insur|health|medical|clinical|pharma/i

/** True when the industry name itself implies regulatory exposure. */
export function isRegulatedIndustry(industry: string | undefined): boolean {
  return !!industry && REGULATED.test(industry)
}
