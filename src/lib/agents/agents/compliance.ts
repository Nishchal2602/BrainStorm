import type { Agent } from '../agent'
import type { Logger } from '../logger'
import type { AgentContext, AgentResult, CompliancePayload } from '../types'
import { getClassification, isRegulatedIndustry } from './shared'

const STUB = 'Compliance not yet implemented (no external retrieval).'

/**
 * Identifies regulatory considerations.
 * STUB: contract only.
 */
export class ComplianceAgent implements Agent {
  readonly id = 'compliance'
  readonly name = 'Compliance'
  constructor(private readonly logger: Logger) {}

  async shouldRun(ctx: AgentContext): Promise<boolean> {
    const c = getClassification(ctx)
    const sens = c?.regulatorySensitivity ?? 'low'
    // Run only when there is meaningful regulatory exposure — so a simple UX
    // change (low/none) skips it, while fintech/health/etc. trigger it.
    return sens === 'medium' || sens === 'high' || isRegulatedIndustry(c?.industry ?? ctx.industry)
  }

  async execute(_ctx: AgentContext): Promise<AgentResult<CompliancePayload>> {
    this.logger.debug('compliance: stub execute')
    const data: CompliancePayload = { regulations: [], risks: [], requirements: [] }
    return { agentId: this.id, summary: STUB, findings: [], confidence: 0, data, status: 'ok' }
  }
}
