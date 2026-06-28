import type { AgentContext, AgentResult } from './types'

/**
 * The contract every specialist agent implements. Dependencies (LLM port,
 * logger) are injected via the agent's constructor, so execute() keeps the
 * spec-exact single-argument signature.
 */
export interface Agent {
  readonly id: string
  readonly name: string
  /** Whether this agent is relevant to the current context (orchestrator gating). */
  shouldRun(context: AgentContext): Promise<boolean>
  /** Run the agent. Must resolve (never reject) for stubs; the orchestrator also
   * guards with timeout + try/catch for defense in depth. */
  execute(context: AgentContext): Promise<AgentResult>
}
