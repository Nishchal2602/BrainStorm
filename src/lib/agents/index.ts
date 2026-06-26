import type { ModelId } from '@/lib/types'
import { DocumentAnalyzer } from './analyzer'
import { ClaudeLlmAdapter, type LlmPort } from './llm'
import { consoleLogger, type Logger } from './logger'
import { Orchestrator } from './orchestrator'
import { AgentRegistry } from './registry'
import { Synthesizer } from './synthesis'
import { CompetitorIntelligenceAgent } from './agents/competitor'
import { ComplianceAgent } from './agents/compliance'
import { CustomerVoiceAgent } from './agents/customerVoice'
import { PrdQualityAgent } from './agents/prdQuality'
import { ResearchAgent } from './agents/research'
import { SolutionCriticAgent } from './agents/solutionCritic'

export * from './types'
export type { Agent } from './agent'
export type { LlmPort } from './llm'
export type { Logger } from './logger'
export { AgentRegistry } from './registry'
export { Orchestrator } from './orchestrator'
export { reportToSections } from './synthesis'
export { customerVoiceSections } from './agents/customerVoice/sections'

export interface CreateOrchestratorDeps {
  /** Active model (Gemini in practice; ignored when a Gemini/proxy key is set). */
  model: ModelId
  apiKey?: string
  /** Override the LLM transport (e.g. a fake in tests). */
  llm?: LlmPort
  logger?: Logger
  agentTimeoutMs?: number
}

/** Composition root: wires the LLM adapter, analyzer, synthesizer, registry, and all built-in agents. */
export function createDefaultOrchestrator(deps: CreateOrchestratorDeps): Orchestrator {
  const logger = deps.logger ?? consoleLogger
  const llm = deps.llm ?? new ClaudeLlmAdapter(deps.model, deps.apiKey)

  const registry = new AgentRegistry()
  registry
    .register(new CustomerVoiceAgent(logger, llm))
    .register(new ResearchAgent(logger))
    .register(new CompetitorIntelligenceAgent(logger))
    .register(new ComplianceAgent(logger))
    .register(new SolutionCriticAgent(logger))
    .register(new PrdQualityAgent(logger))

  return new Orchestrator({
    registry,
    analyzer: new DocumentAnalyzer(llm, logger),
    synthesizer: new Synthesizer(llm, logger),
    logger,
    // Claim validation makes 2 LLM calls + Reddit fetch + comments; give headroom.
    agentTimeoutMs: deps.agentTimeoutMs ?? 45_000,
  })
}
