import type { Agent } from '../agent'
import type { Logger } from '../logger'
import type { AgentContext, AgentResult, CustomerVoicePayload } from '../types'
import { getReviewContext } from './shared'

const STUB = 'Customer Voice not yet implemented (no external retrieval).'

/**
 * Determines whether users actually experience the problem.
 * Future sources: Reddit, Quora, community forums, product reviews.
 * STUB: contract only — returns a typed empty payload until retrieval lands.
 */
export class CustomerVoiceAgent implements Agent {
  readonly id = 'customer_voice'
  readonly name = 'Customer Voice'
  constructor(private readonly logger: Logger) {}

  async shouldRun(ctx: AgentContext): Promise<boolean> {
    // Problem validation is relevant to almost everything except pure exec comms.
    return getReviewContext(ctx)?.reviewType !== 'exec_comm'
  }

  async execute(_ctx: AgentContext): Promise<AgentResult<CustomerVoicePayload>> {
    this.logger.debug('customer_voice: stub execute')
    const data: CustomerVoicePayload = {
      recurringPainPoints: [],
      userSegments: [],
      sentimentSummary: '',
      supportingEvidence: [],
    }
    return { agentId: this.id, summary: STUB, findings: [], confidence: 0, data, status: 'ok' }
  }
}
