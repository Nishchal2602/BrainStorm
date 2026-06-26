import type { TokenUsage } from '@/lib/types'
import type { Agent } from '../../agent'
import type { LlmPort } from '../../llm'
import type { Logger } from '../../logger'
import { now } from '../../runtime'
import type { AgentContext, AgentResult, CustomerVoicePayload } from '../../types'
import { getDocumentAnalysis, getReviewContext } from '../shared'
import { buildCustomerVoice } from './build'
import { extractClaims } from './claims'
import { searchReddit } from './reddit'
import { groundedFallback } from './retrieval'
import { scoreClaims } from './score'
import { buildUnits, verifyEvidence } from './verify'

const MIN_REDDIT_POSTS = 3
const MAX_QUERIES = 14

const EMPTY: CustomerVoicePayload = {
  claims: [],
  claimsEvaluated: 0,
  discussionCount: 0,
  distinctSubreddits: [],
  overallConfidence: 0,
  overallConfidenceLabel: 'Low',
  evidenceLevel: 'No evidence found',
  affectedUsers: [],
}

function dedupCap(items: string[], cap: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of items) {
    const q = raw.trim()
    if (q.length < 3) continue
    const k = q.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(q)
    if (out.length >= cap) break
  }
  return out
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
 * Customer Voice — claim-based validation. Extract falsifiable claims (+ supporting
 * and contradicting queries) → fetch Reddit (grounding fallback) → verify each
 * comment/post against the claims → quality-score + diversity-weight → per-claim
 * verdicts. Evidence is verbatim and traceable; never asserts demand is absent.
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
      const { claims, usage: claimsUsage } = await extractClaims(this.llm, analysis, problem, meta)
      if (!claims.length) {
        return { agentId: this.id, summary: 'Could not derive validation claims from the document.', findings: [], confidence: 0, data: EMPTY, status: 'ok', usage: claimsUsage, durationMs: dur() }
      }
      this.logger.info('customer_voice: claims', { count: claims.length, claims: claims.map((c) => c.claim) })

      const queries = dedupCap(
        claims.flatMap((c) => [...c.supportingQueries, ...c.contradictingQueries]),
        MAX_QUERIES,
      )
      const relevanceTerms = [
        analysis?.coreProblem ?? '',
        ...(analysis?.synonyms ?? []),
        ...claims.map((c) => c.claim),
      ].filter(Boolean)

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
      const { judgments, usage: verifyUsage } = await verifyEvidence(this.llm, claims, units, meta)
      const score = scoreClaims(claims, judgments, units, docs.length)
      const built = buildCustomerVoice(score)

      this.logger.info('customer_voice: scored', {
        claims: score.claimsEvaluated,
        evidenceLevel: score.evidenceLevel,
        confidence: score.overallConfidence,
        units: units.length,
        kept: score.claims.reduce((n, c) => n + c.supportingCount + c.contradictingCount, 0),
        fallback: usedFallback,
        durationMs: dur(),
      })

      const summary =
        `Evaluated ${score.claimsEvaluated} claim${score.claimsEvaluated === 1 ? '' : 's'} against ${score.discussionCount} discussion${score.discussionCount === 1 ? '' : 's'}: ${score.evidenceLevel} (confidence ${score.overallConfidence}/100). ` +
        'Absence of public evidence is not evidence of absent demand.'

      return {
        agentId: this.id,
        summary,
        findings: built.findings,
        confidence: built.confidence,
        data: built.payload,
        status: 'ok',
        usage: sumUsage(claimsUsage, fbUsage, verifyUsage),
        durationMs: dur(),
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.error('customer_voice: failed', msg)
      return { agentId: this.id, summary: `Customer Voice failed: ${msg}`, findings: [], confidence: 0, data: EMPTY, status: 'error', error: msg, durationMs: dur() }
    }
  }
}
