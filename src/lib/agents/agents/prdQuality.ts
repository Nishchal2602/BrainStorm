import type { Agent } from '../agent'
import type { Logger } from '../logger'
import type { AgentContext, AgentResult, PrdQualityPayload } from '../types'

const STUB = 'PRD Quality not yet implemented (stub).'

/**
 * Evaluates document quality: missing requirements, metrics, acceptance criteria.
 * STUB: contract only (kept a stub per the V2 brief).
 */
export class PrdQualityAgent implements Agent {
  readonly id = 'prd_quality'
  readonly name = 'PRD Quality'
  constructor(private readonly logger: Logger) {}

  async shouldRun(_ctx: AgentContext): Promise<boolean> {
    // Document quality applies to every review.
    return true
  }

  async execute(_ctx: AgentContext): Promise<AgentResult<PrdQualityPayload>> {
    this.logger.debug('prd_quality: stub execute')
    const data: PrdQualityPayload = {
      missingRequirements: [],
      missingMetrics: [],
      missingAcceptanceCriteria: [],
    }
    return { agentId: this.id, summary: STUB, findings: [], confidence: 0, data, status: 'ok' }
  }
}
