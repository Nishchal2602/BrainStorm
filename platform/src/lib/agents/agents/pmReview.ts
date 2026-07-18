import type { ReviewContext, Section, UserContext } from '@/lib/types'
import { buildContextBlock } from '@/lib/context/contextBlock'
import { parseReadinessReview, PM_REVIEW_SYSTEM, type ReadinessIssue } from '@/lib/features/pmReview'
import type { Agent } from '../agent'
import type { LlmPort } from '../llm'
import type { Logger } from '../logger'
import type { AgentContext, AgentResult, Finding, PmReviewAgentPayload } from '../types'

// Reviewer certainty (High/Medium/Low) → the 0..1 confidence synthesis weighs.
const CONFIDENCE_NUM: Record<'High' | 'Medium' | 'Low', number> = {
  High: 0.9,
  Medium: 0.6,
  Low: 0.3,
}

// Caps applied BEFORE synthesis so one verbose review can't dominate the
// synthesis prompt (sections/payload keep the full lists for the UI).
const MAX_CRITICAL = 5
const MAX_MEDIUM = 5
const MAX_MINOR = 3
const MAX_MISSING = 5
const MAX_QUESTIONS = 3

function issueFinding(
  i: ReadinessIssue,
  kind: Finding['kind'],
  severity: Finding['severity'],
): Finding {
  return {
    title: i.title,
    detail: [i.why, i.impact && `Impact: ${i.impact}`, i.fix && `Fix: ${i.fix}`]
      .filter(Boolean)
      .join(' — '),
    kind,
    severity,
    confidence: i.confidence ? CONFIDENCE_NUM[i.confidence] : undefined,
  }
}

/**
 * Staff-PM implementation-readiness reviewer inside Deep analysis. Reuses the
 * standalone PM Review SYSTEM + XML parser (single source of truth); its
 * findings give synthesis real execution-readiness signal. Replaces the old
 * PrdQuality stub. No web search — the document is the source of truth.
 */
export class PmReviewAgent implements Agent {
  readonly id = 'pm_review'
  readonly name = 'PM Review'

  constructor(
    private readonly logger: Logger,
    private readonly llm: LlmPort,
  ) {}

  async shouldRun(_ctx: AgentContext): Promise<boolean> {
    // Implementation readiness applies to every deep review.
    return true
  }

  async execute(ctx: AgentContext): Promise<AgentResult<PmReviewAgentPayload>> {
    const meta = ctx.metadata ?? {}
    const userCtx = meta.userContext as UserContext | undefined
    const reviewCtx = meta.reviewContext as ReviewContext | undefined
    const contextBlock = userCtx ? buildContextBlock(userCtx, reviewCtx) : ''

    const user = [
      contextBlock,
      ctx.document,
      'Review the PRD above against any USER & REVIEW CONTEXT provided, and return the implementation-readiness review as the specified XML.',
    ]
      .filter(Boolean)
      .join('\n\n')

    const { text, usage } = await this.llm.generateText({
      system: PM_REVIEW_SYSTEM,
      user,
      maxTokens: 5000,
      label: 'pm_review_agent',
      meta: meta.clientId ? { clientId: String(meta.clientId) } : undefined,
    })

    const { review, sections } = parseReadinessReview(text)

    // Missing items, highest-leverage category first, capped as one pool.
    const missing: Array<{ item: string; category: string }> = [
      ...review.missingRequirements.map((item) => ({ item, category: 'requirement' })),
      ...review.missingAcceptanceCriteria.map((item) => ({ item, category: 'acceptance criterion' })),
      ...review.missingUserFlows.map((item) => ({ item, category: 'user flow' })),
      ...review.missingEdgeCases.map((item) => ({ item, category: 'edge case' })),
      ...review.missingNfrs.map((item) => ({ item, category: 'non-functional requirement' })),
    ]
    const questions = [...review.productQuestions, ...review.engineeringQuestions]

    const findings: Finding[] = [
      ...review.critical.slice(0, MAX_CRITICAL).map((i) => issueFinding(i, 'risk', 'high')),
      ...review.medium.slice(0, MAX_MEDIUM).map((i) => issueFinding(i, 'risk', 'medium')),
      ...review.minor.slice(0, MAX_MINOR).map((i) => issueFinding(i, 'insight', 'low')),
      ...missing.slice(0, MAX_MISSING).map(
        (m): Finding => ({ title: m.item, detail: `Missing ${m.category}`, kind: 'gap', severity: 'medium' }),
      ),
      ...questions.slice(0, MAX_QUESTIONS).map(
        (q): Finding => ({ title: q, detail: 'Open question for the author', kind: 'assumption' }),
      ),
    ]
    if (review.readiness != null) {
      findings.push({
        title: `PRD readiness ${review.readiness}/100 — ${review.decision ?? 'no decision'}`,
        detail: review.rationale ?? '',
        kind: 'insight',
      })
    }

    this.logger.info('pm_review agent', {
      readiness: review.readiness,
      decision: review.decision,
      critical: review.critical.length,
      medium: review.medium.length,
      minor: review.minor.length,
      missing: missing.length,
      findings: findings.length,
    })

    return {
      agentId: this.id,
      summary: `PRD readiness ${review.readiness ?? '—'}/100 — ${review.decision ?? 'no decision'} · ${review.critical.length} critical / ${review.medium.length} medium issues`,
      findings,
      // Reviewer certainty — deliberately NOT readiness/100 (a reviewer can be
      // highly confident that a document is NOT ready).
      confidence: review.reviewerConfidence ? CONFIDENCE_NUM[review.reviewerConfidence] : 0.5,
      data: { review, sections, raw: text },
      status: 'ok',
      usage,
    }
  }
}

/** Cards for the deep-analysis output (pre-built by the shared parser). */
export function pmReviewAgentSections(results: AgentResult[]): Section[] {
  const r = results.find((x) => x.agentId === 'pm_review' && x.status === 'ok')
  return (r?.data as PmReviewAgentPayload | undefined)?.sections ?? []
}
