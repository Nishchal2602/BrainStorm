import type { Agent } from '../agent'
import type { Logger } from '../logger'
import type { AgentContext, AgentResult, SolutionCriticPayload } from '../types'

const STUB = 'Solution Critic not yet implemented (stub).'

/**
 * Red-team reviewer: hidden assumptions, failure modes, abuse cases, rollout risks.
 * STUB: contract only (kept a stub per the V2 brief).
 */
export class SolutionCriticAgent implements Agent {
  readonly id = 'solution_critic'
  readonly name = 'Solution Critic'
  constructor(private readonly logger: Logger) {}

  async shouldRun(_ctx: AgentContext): Promise<boolean> {
    // Always red-team the proposed solution.
    return true
  }

  async execute(_ctx: AgentContext): Promise<AgentResult<SolutionCriticPayload>> {
    this.logger.debug('solution_critic: stub execute')
    const data: SolutionCriticPayload = { assumptions: [], risks: [], edgeCases: [] }
    return { agentId: this.id, summary: STUB, findings: [], confidence: 0, data, status: 'ok' }
  }
}
