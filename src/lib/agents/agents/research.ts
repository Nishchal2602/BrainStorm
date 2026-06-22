import type { Agent } from '../agent'
import type { Logger } from '../logger'
import type { AgentContext, AgentResult, ResearchPayload } from '../types'
import { getClassification, getReviewContext } from './shared'

const STUB = 'Research not yet implemented (no external retrieval).'

/**
 * Finds evidence supporting or contradicting the hypothesis.
 * Future sources: research papers, whitepapers, industry reports.
 * STUB: contract only.
 */
export class ResearchAgent implements Agent {
  readonly id = 'research'
  readonly name = 'Research'
  constructor(private readonly logger: Logger) {}

  async shouldRun(ctx: AgentContext): Promise<boolean> {
    // Evidence matters most for new products and strategy/PRD-level decisions.
    if (getClassification(ctx)?.isNewProduct) return true
    const rt = getReviewContext(ctx)?.reviewType
    return rt === 'prd' || rt === 'product_strategy'
  }

  async execute(_ctx: AgentContext): Promise<AgentResult<ResearchPayload>> {
    this.logger.debug('research: stub execute')
    const data: ResearchPayload = {
      supportingEvidence: [],
      contradictingEvidence: [],
      confidenceScore: 0,
    }
    return { agentId: this.id, summary: STUB, findings: [], confidence: 0, data, status: 'ok' }
  }
}
