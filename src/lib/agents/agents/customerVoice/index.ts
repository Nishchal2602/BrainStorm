import type { Agent } from '../../agent'
import type { LlmPort } from '../../llm'
import type { Logger } from '../../logger'
import { now } from '../../runtime'
import type { AgentContext, AgentResult, CustomerVoicePayload } from '../../types'
import { getDocumentAnalysis, getReviewContext } from '../shared'
import { toPayloadAndFindings } from './cluster'
import { parseCustomerVoice } from './parse'
import { buildQueries } from './queries'
import { GroundedRetrievalService, type RetrievalService } from './retrieval'

const EMPTY: CustomerVoicePayload = {
  recurringPainPoints: [],
  userSegments: [],
  sentimentSummary: '',
  supportingEvidence: [],
}

/**
 * Customer Voice V1 — determines whether users actually experience the problem.
 * Reuses the shared DocumentAnalysis search plan → grounded retrieval of public
 * discussions → pure clustering → structured findings for synthesis.
 */
export class CustomerVoiceAgent implements Agent {
  readonly id = 'customer_voice'
  readonly name = 'Customer Voice'
  private readonly retrieval: RetrievalService

  constructor(
    private readonly logger: Logger,
    llm: LlmPort,
    retrieval?: RetrievalService,
  ) {
    this.retrieval = retrieval ?? new GroundedRetrievalService(llm)
  }

  async shouldRun(ctx: AgentContext): Promise<boolean> {
    return getReviewContext(ctx)?.reviewType !== 'exec_comm'
  }

  async execute(ctx: AgentContext): Promise<AgentResult<CustomerVoicePayload>> {
    const start = now()
    const analysis = getDocumentAnalysis(ctx)
    const queries = buildQueries(analysis)

    if (!queries.length) {
      this.logger.info('customer_voice: no search queries; skipping retrieval')
      return {
        agentId: this.id,
        summary: 'No search queries available from the document analysis.',
        findings: [],
        confidence: 0,
        data: EMPTY,
        status: 'ok',
        durationMs: Math.round(now() - start),
      }
    }

    try {
      this.logger.info('customer_voice: searching', { coreProblem: analysis?.coreProblem, queries })
      const { text, sources, usage } = await this.retrieval.search(queries)
      const parsed = parseCustomerVoice(text)
      const { payload, findings, confidence, discussionCount } = toPayloadAndFindings(parsed, sources)
      this.logger.info('customer_voice: clustered', {
        discussions: discussionCount,
        painPoints: payload.recurringPainPoints.length,
        summary: payload.sentimentSummary,
        durationMs: Math.round(now() - start),
      })
      const k = payload.recurringPainPoints.length
      const summary = discussionCount
        ? `Analyzed ${discussionCount} customer discussion${discussionCount === 1 ? '' : 's'}; ${k} recurring complaint${k === 1 ? '' : 's'} identified.`
        : 'No relevant public customer discussions found.'
      return {
        agentId: this.id,
        summary,
        findings,
        confidence,
        evidence: payload.supportingEvidence,
        data: payload,
        status: 'ok',
        usage,
        durationMs: Math.round(now() - start),
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.error('customer_voice: retrieval failed', msg)
      return {
        agentId: this.id,
        summary: `Customer Voice retrieval failed: ${msg}`,
        findings: [],
        confidence: 0,
        data: EMPTY,
        status: 'error',
        error: msg,
        durationMs: Math.round(now() - start),
      }
    }
  }
}
