import type { ReviewContext } from '@/lib/types'
import type { AgentContext, DocumentAnalysis } from '../types'

/** The shared document analysis (classification + problem), stashed by the orchestrator. */
export function getDocumentAnalysis(ctx: AgentContext): DocumentAnalysis | undefined {
  return ctx.metadata?.analysis as DocumentAnalysis | undefined
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

const line = (label: string, value: string | undefined): string | null => {
  const v = (value ?? '').trim()
  return v ? `${label}: ${v}` : null
}
const list = (label: string, items: string[] | undefined): string | null =>
  items && items.length ? `${label}:\n${items.map((i) => `- ${i}`).join('\n')}` : null

/**
 * The compact structured product context (~500–700 tokens) downstream agents and
 * synthesis read INSTEAD of the full document. PM Review is the exception — a
 * completeness review needs the original PRD.
 */
export function compactContext(
  analysis: DocumentAnalysis | undefined,
  review?: ReviewContext,
): string {
  if (!analysis && !review) return ''
  const parts = [
    line('Problem', analysis?.coreProblem || review?.problemStatement),
    line('Target users', analysis?.persona || review?.targetUser),
    line('Industry', analysis?.industry !== 'Unknown' ? analysis?.industry : undefined),
    line('Solution category', analysis?.solutionCategory !== 'Unknown' ? analysis?.solutionCategory : undefined),
    line('Workflow', analysis?.workflowSummary),
    list('Key capabilities', analysis?.keyCapabilities?.slice(0, 8)),
    list('Goals', analysis?.goals),
    list('Key requirements', analysis?.keyRequirements),
    list('Constraints / non-goals', analysis?.constraints),
    list('Differentiating assumptions', analysis?.differentiators),
    line('Architecture', analysis?.architectureSummary),
    list('Success metrics', analysis?.successMetrics?.length ? analysis.successMetrics : review?.successMetric ? [review.successMetric] : undefined),
    line('Feature under review', review?.featureName),
  ].filter(Boolean)
  if (!parts.length) return ''
  return 'PRODUCT CONTEXT (structured summary of the document under review):\n' + parts.join('\n')
}
