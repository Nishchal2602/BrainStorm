import type { Agent } from '../agent'
import type { Logger } from '../logger'
import type { AgentContext, AgentResult, CompetitorPayload } from '../types'
import { getClassification, getReviewContext } from './shared'

const STUB = 'Competitor Intelligence not yet implemented (no external retrieval).'

/**
 * Maps the competitive landscape.
 * STUB: contract only.
 */
export class CompetitorIntelligenceAgent implements Agent {
  readonly id = 'competitor'
  readonly name = 'Competitor Intelligence'
  constructor(private readonly logger: Logger) {}

  async shouldRun(ctx: AgentContext): Promise<boolean> {
    const c = getClassification(ctx)
    if (c?.isNewProduct) return true
    if (c && c.productCategory !== 'Unknown') return true
    const rt = getReviewContext(ctx)?.reviewType
    return rt === 'product_strategy' || rt === 'roadmap'
  }

  async execute(_ctx: AgentContext): Promise<AgentResult<CompetitorPayload>> {
    this.logger.debug('competitor: stub execute')
    const data: CompetitorPayload = { competitors: [], featureComparison: [], gaps: [] }
    return { agentId: this.id, summary: STUB, findings: [], confidence: 0, data, status: 'ok' }
  }
}
