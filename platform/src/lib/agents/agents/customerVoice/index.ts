import type { TokenUsage } from '@/lib/types'
import type { Agent } from '../../agent'
import type { LlmPort } from '../../llm'
import type { Logger } from '../../logger'
import { now } from '../../runtime'
import type { AgentContext, AgentResult, CustomerVoicePayload } from '../../types'
import { getDocumentAnalysis, getReviewContext } from '../shared'
import { buildCustomerVoice } from './build'
import { buildAllQueries } from './queries'
import { searchReddit } from './reddit'
import { groundedFallback } from './retrieval'
import { scoreHypotheses } from './score'
import { validateClaims } from './validate'
import { buildUnits, selectTopUnitsForValidation } from './verify'

const MIN_REDDIT_POSTS = 3
const MAX_QUERIES = 15
const MAX_VALIDATION_UNITS = 24
// Grounded web-search evidence is a weaker signal than real Reddit discussion —
// scale its overall confidence by this factor (Reddit-sourced evidence keeps ×1.0).
const GROUNDED_CONFIDENCE_MULTIPLIER = 0.7

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
 * Customer Voice — claim validation engine, ONE LLM call. Analysis-derived
 * queries → fetch Reddit (grounding fallback) → cap/diversify units → a single
 * merged call that extracts the product's distinct claims AND judges every unit
 * against them (problem/persona/product relevance) → pure quality-filter +
 * product-form confidence → per-claim verdicts. Evidence is verbatim and
 * traceable; never asserts demand is absent.
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
      // Retrieval first — queries come from the shared analysis (no LLM needed).
      const queries = buildAllQueries(analysis, MAX_QUERIES)
      const relevanceTerms = [
        analysis?.coreProblem ?? '',
        ...(analysis?.synonyms ?? []),
        ...(analysis?.searchQueries ?? []),
      ].filter(Boolean)
      this.logger.info('customer_voice: queries', { queries })

      let docs = await searchReddit(queries, relevanceTerms, this.logger)
      let usedFallback = false
      let fbUsage: TokenUsage | undefined
      // The grounded fallback is an extra grounded LLM call that substitutes for
      // Reddit when it returns too little. Callers on a server (where Reddit IPs
      // are throttled so this would fire almost every run) can opt out via
      // metadata to save a grounding call / rate-limit budget; browser callers
      // leave it on. Absent the flag, behavior is unchanged.
      const skipFallback = ctx.metadata?.skipGroundedFallback === true
      if (docs.length < MIN_REDDIT_POSTS && !skipFallback) {
        usedFallback = true
        const fb = await groundedFallback(this.llm, queries, meta)
        docs = fb.docs
        fbUsage = fb.usage
        this.logger.warn('customer_voice: reddit unavailable, grounding fallback', { posts: docs.length })
      }

      // THE one merged call: claim extraction + evidence judgment over the
      // capped, diversity-selected units. Scoring stays pure.
      const units = selectTopUnitsForValidation(buildUnits(docs), MAX_VALIDATION_UNITS)
      const { hypotheses, judgments, usage: valUsage } = await validateClaims(
        this.llm, analysis, review, problem, units, meta,
      )
      if (!hypotheses.length) {
        return { agentId: this.id, summary: 'Could not derive validation claims from the document.', findings: [], confidence: 0, data: EMPTY, status: 'ok', usage: sumUsage(fbUsage, valUsage), durationMs: dur() }
      }
      this.logger.info('customer_voice: claims', {
        count: hypotheses.length,
        statements: hypotheses.map((h) => `${h.category}: ${h.statement}`),
        unitsJudged: units.length,
      })

      const score = scoreHypotheses(hypotheses, judgments, units, docs.length)
      const built = buildCustomerVoice(score)

      // Grounded web-search evidence is a weaker signal than real Reddit discussion —
      // scale confidence down and label the source so it isn't read as community
      // discussion. Reddit-sourced evidence keeps full weight (×1.0).
      if (usedFallback) {
        const downgrade = (
          l: CustomerVoicePayload['overallConfidenceLabel'],
        ): CustomerVoicePayload['overallConfidenceLabel'] =>
          l === 'High' ? 'Medium' : l === 'Medium' ? 'Low' : l
        built.confidence = built.confidence * GROUNDED_CONFIDENCE_MULTIPLIER
        built.payload.overallConfidence = Math.round(
          built.payload.overallConfidence * GROUNDED_CONFIDENCE_MULTIPLIER,
        )
        built.payload.overallConfidenceLabel = downgrade(built.payload.overallConfidenceLabel)
      }

      this.logger.info('customer_voice: scored', {
        hypotheses: score.hypothesesEvaluated,
        evidenceLevel: built.payload.evidenceLevel,
        confidence: built.payload.overallConfidence,
        verdicts: { supported: score.supportedCount, mixed: score.mixedCount, contradicted: score.contradictedCount, insufficient: score.insufficientCount },
        units: units.length,
        kept: score.hypotheses.reduce((n, h) => n + h.supportingCount + h.contradictingCount, 0),
        fallback: usedFallback,
        durationMs: dur(),
      })

      const n = score.hypothesesEvaluated
      const sourceWord = usedFallback ? 'web-search result' : 'discussion'
      const summary =
        `Evaluated ${n} hypothes${n === 1 ? 'is' : 'es'} against ${score.discussionCount} ${sourceWord}${score.discussionCount === 1 ? '' : 's'}: ${built.payload.evidenceLevel} (overall confidence ${built.payload.overallConfidence}/100). ` +
        'Absence of public evidence is not evidence of absent demand.'

      return {
        agentId: this.id,
        summary,
        findings: built.findings,
        confidence: built.confidence,
        data: built.payload,
        status: 'ok',
        usage: sumUsage(fbUsage, valUsage),
        durationMs: dur(),
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.error('customer_voice: failed', msg)
      return { agentId: this.id, summary: `Customer Voice failed: ${msg}`, findings: [], confidence: 0, data: EMPTY, status: 'error', error: msg, durationMs: dur() }
    }
  }
}
