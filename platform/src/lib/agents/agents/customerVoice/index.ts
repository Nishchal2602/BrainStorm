import type { TokenUsage } from '@/lib/types'
import type { Agent } from '../../agent'
import type { LlmPort } from '../../llm'
import type { Logger } from '../../logger'
import { now } from '../../runtime'
import type { AgentContext, AgentResult, CustomerVoicePayload } from '../../types'
import { getDocumentAnalysis, getReviewContext } from '../shared'
import { buildCustomerVoice } from './build'
import { extractHypotheses } from './hypothesis'
import { buildAllQueries } from './queries'
import { searchReddit } from './reddit'
import { groundedFallback } from './retrieval'
import { scoreHypotheses } from './score'
import { buildUnits, verifyEvidence } from './verify'

const MIN_REDDIT_POSTS = 3
const MAX_QUERIES = 15

const EMPTY: CustomerVoicePayload = {
  hypotheses: [],
  hypothesesEvaluated: 0,
  supportedCount: 0,
  mixedCount: 0,
  insufficientCount: 0,
  contradictedCount: 0,
  discussionCount: 0,
  distinctSubreddits: [],
  overallConfidence: 0,
  overallConfidenceLabel: 'Low',
  evidenceLevel: 'Insufficient public evidence',
  affectedUsers: [],
}

function sumUsage(...parts: (TokenUsage | undefined)[]): TokenUsage | undefined {
  const xs = parts.filter((x): x is TokenUsage => !!x)
  if (!xs.length) return undefined
  return xs.reduce((a, b) => ({
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
    thoughtsTokens: (a.thoughtsTokens ?? 0) + (b.thoughtsTokens ?? 0),
    totalTokens: (a.totalTokens ?? 0) + (b.totalTokens ?? 0),
  }))
}

/**
 * Customer Voice — hypothesis validation engine. Extract the assumptions the product
 * depends on (+ the customer vernacular for each) → build customer-language queries
 * → fetch Reddit (grounding fallback) → verify each comment/post with problem/persona/
 * product relevance → quality-filter + product-form confidence → per-hypothesis verdicts.
 * Evidence is verbatim and traceable; never asserts demand is absent.
 */
export class CustomerVoiceAgent implements Agent {
  readonly id = 'customer_voice'
  readonly name = 'Customer Voice'

  constructor(
    private readonly logger: Logger,
    private readonly llm: LlmPort,
  ) {}

  async shouldRun(ctx: AgentContext): Promise<boolean> {
    return getReviewContext(ctx)?.reviewType !== 'exec_comm'
  }

  async execute(ctx: AgentContext): Promise<AgentResult<CustomerVoicePayload>> {
    const start = now()
    const dur = () => Math.round(now() - start)
    const analysis = getDocumentAnalysis(ctx)
    const review = getReviewContext(ctx)
    const problem = (
      analysis?.coreProblem ||
      review?.problemStatement ||
      review?.featureName ||
      ''
    ).trim()
    const meta = ctx.metadata?.clientId ? { clientId: String(ctx.metadata.clientId) } : undefined

    if (!problem) {
      return { agentId: this.id, summary: 'Insufficient context to validate customer evidence.', findings: [], confidence: 0, data: EMPTY, status: 'ok', durationMs: dur() }
    }

    try {
      const { hypotheses, usage: hypUsage } = await extractHypotheses(this.llm, analysis, problem, meta)
      if (!hypotheses.length) {
        return { agentId: this.id, summary: 'Could not derive validation hypotheses from the document.', findings: [], confidence: 0, data: EMPTY, status: 'ok', usage: hypUsage, durationMs: dur() }
      }
      this.logger.info('customer_voice: hypotheses', {
        count: hypotheses.length,
        statements: hypotheses.map((h) => `${h.category}: ${h.statement}`),
      })

      const queries = buildAllQueries(hypotheses, analysis, MAX_QUERIES)
      const relevanceTerms = [
        analysis?.coreProblem ?? '',
        ...(analysis?.synonyms ?? []),
        ...hypotheses.map((h) => h.statement),
        ...hypotheses.flatMap((h) => h.customerLanguage),
      ].filter(Boolean)
      this.logger.info('customer_voice: queries', { queries })

      let docs = await searchReddit(queries, relevanceTerms, this.logger)
      let usedFallback = false
      let fbUsage: TokenUsage | undefined
      if (docs.length < MIN_REDDIT_POSTS) {
        usedFallback = true
        const fb = await groundedFallback(this.llm, queries, meta)
        docs = fb.docs
        fbUsage = fb.usage
        this.logger.warn('customer_voice: reddit unavailable, grounding fallback', { posts: docs.length })
      }

      const units = buildUnits(docs)
      const { judgments, usage: verifyUsage } = await verifyEvidence(this.llm, hypotheses, units, analysis, meta)
      const score = scoreHypotheses(hypotheses, judgments, units, docs.length)
      const built = buildCustomerVoice(score)

      this.logger.info('customer_voice: scored', {
        hypotheses: score.hypothesesEvaluated,
        evidenceLevel: score.evidenceLevel,
        confidence: score.overallConfidence,
        verdicts: { supported: score.supportedCount, mixed: score.mixedCount, contradicted: score.contradictedCount, insufficient: score.insufficientCount },
        units: units.length,
        kept: score.hypotheses.reduce((n, h) => n + h.supportingCount + h.contradictingCount, 0),
        fallback: usedFallback,
        durationMs: dur(),
      })

      const n = score.hypothesesEvaluated
      const summary =
        `Evaluated ${n} hypothes${n === 1 ? 'is' : 'es'} against ${score.discussionCount} discussion${score.discussionCount === 1 ? '' : 's'}: ${score.evidenceLevel} (overall confidence ${score.overallConfidence}/100). ` +
        'Absence of public evidence is not evidence of absent demand.'

      return {
        agentId: this.id,
        summary,
        findings: built.findings,
        confidence: built.confidence,
        data: built.payload,
        status: 'ok',
        usage: sumUsage(hypUsage, fbUsage, verifyUsage),
        durationMs: dur(),
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.error('customer_voice: failed', msg)
      return { agentId: this.id, summary: `Customer Voice failed: ${msg}`, findings: [], confidence: 0, data: EMPTY, status: 'error', error: msg, durationMs: dur() }
    }
  }
}
