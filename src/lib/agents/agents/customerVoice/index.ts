import type { Agent } from '../../agent'
import type { LlmPort } from '../../llm'
import type { Logger } from '../../logger'
import { now } from '../../runtime'
import type { AgentContext, AgentResult, CustomerVoicePayload } from '../../types'
import { getDocumentAnalysis, getReviewContext } from '../shared'
import { buildCustomerVoice } from './build'
import { extractThemes } from './extract'
import { buildQueries } from './queries'
import { searchReddit } from './reddit'
import { groundedFallback } from './retrieval'
import { scoreThemes } from './score'

const MIN_REDDIT_POSTS = 3

const EMPTY: CustomerVoicePayload = {
  confidence: 0,
  confidenceLabel: 'Low',
  discussionCount: 0,
  distinctSubreddits: [],
  themes: [],
  userSegments: [],
  sentimentSummary: '',
  recommendation: 'Weak Signal',
}

/**
 * Customer Voice Evidence Engine (Reddit-first). Reuses the shared DocumentAnalysis
 * search plan → fetches real Reddit discussions (grounding fallback) → LLM extracts
 * verbatim complaint quotes + themes → pure scoring/confidence → structured findings
 * for synthesis. Evidence is real and traceable; failures degrade to status:'error'.
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
    const analysis = getDocumentAnalysis(ctx)
    const review = getReviewContext(ctx)
    const problem = (analysis?.coreProblem || review?.problemStatement || review?.featureName || '').trim()
    const queries = buildQueries(analysis)
    const meta = ctx.metadata?.clientId ? { clientId: String(ctx.metadata.clientId) } : undefined

    if (!queries.length || !problem) {
      this.logger.info('customer_voice: insufficient context; skipping retrieval')
      return { agentId: this.id, summary: 'Insufficient context to search for customer evidence.', findings: [], confidence: 0, data: EMPTY, status: 'ok', durationMs: Math.round(now() - start) }
    }

    try {
      this.logger.info('customer_voice: searching reddit', { coreProblem: problem, queries: queries.length })
      let docs = await searchReddit(queries)
      let extraction
      let usage
      let usedFallback = false

      if (docs.length >= MIN_REDDIT_POSTS) {
        const subs = [...new Set(docs.map((d) => d.subreddit))].length
        this.logger.info('customer_voice: reddit results', { posts: docs.length, subreddits: subs })
        const ex = await extractThemes(this.llm, docs, problem, meta)
        extraction = ex.result
        usage = ex.usage
      } else {
        usedFallback = true
        this.logger.warn('customer_voice: reddit unavailable, using grounding fallback', { posts: docs.length })
        const fb = await groundedFallback(this.llm, queries, meta)
        docs = fb.docs
        extraction = fb.extraction
        usage = fb.usage
      }

      const score = scoreThemes(extraction, docs)
      const built = buildCustomerVoice(score, extraction)
      this.logger.info('customer_voice: scored', {
        themes: built.payload.themes.length,
        confidence: built.payload.confidence,
        label: built.payload.confidenceLabel,
        recommendation: built.payload.recommendation,
        fallback: usedFallback,
        durationMs: Math.round(now() - start),
      })

      const k = built.payload.themes.length
      const n = built.payload.discussionCount
      const summary = n
        ? `Analyzed ${n} discussion${n === 1 ? '' : 's'}; ${k} pain theme${k === 1 ? '' : 's'} (confidence ${built.payload.confidence}/100, ${built.payload.confidenceLabel}).`
        : 'No relevant public customer discussions found.'

      return {
        agentId: this.id,
        summary,
        findings: built.findings,
        confidence: built.confidence,
        data: built.payload,
        status: 'ok',
        usage,
        durationMs: Math.round(now() - start),
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.error('customer_voice: failed', msg)
      return { agentId: this.id, summary: `Customer Voice failed: ${msg}`, findings: [], confidence: 0, data: EMPTY, status: 'error', error: msg, durationMs: Math.round(now() - start) }
    }
  }
}
