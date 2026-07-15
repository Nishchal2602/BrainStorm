import type { TokenUsage } from '@/lib/types'
import type { Agent } from './agent'
import type { DocumentAnalyzer } from './analyzer'
import type { Logger } from './logger'
import type { AgentRegistry } from './registry'
import { now, TimeoutError, withTimeout } from './runtime'
import type { Synthesizer } from './synthesis'
import type { AgentContext, AgentResult, OrchestrationResult } from './types'

export interface OrchestratorDeps {
  registry: AgentRegistry
  analyzer: DocumentAnalyzer
  synthesizer: Synthesizer
  logger: Logger
  /** Per-agent time budget (ms). Default 20s. */
  agentTimeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 20_000

function addUsage(a: TokenUsage | undefined, b: TokenUsage | undefined): TokenUsage | undefined {
  if (!a) return b
  if (!b) return a
  return {
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
    thoughtsTokens: (a.thoughtsTokens ?? 0) + (b.thoughtsTokens ?? 0),
    totalTokens: (a.totalTokens ?? 0) + (b.totalTokens ?? 0),
  }
}

/**
 * Coordinates the run: classify → select agents → run in parallel (isolated +
 * timed out) → collect → synthesize. One agent failing never breaks the run.
 */
export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async run(context: AgentContext): Promise<OrchestrationResult> {
    const { registry, analyzer, synthesizer, logger } = this.deps
    const timeout = this.deps.agentTimeoutMs ?? DEFAULT_TIMEOUT_MS

    // Step 1 — analyze (classify + extract problem/search plan) in one call.
    const { analysis, usage: analyzeUsage } = await analyzer.analyze(context)
    logger.info('document analysis', analysis)
    const enriched: AgentContext = {
      ...context,
      industry: context.industry || analysis.industry,
      productType: context.productType || analysis.productCategory,
      metadata: { ...context.metadata, analysis },
    }

    // Step 2 — select (shouldRun, error-isolated).
    const candidates = registry.enabled()
    const decisions = await Promise.all(
      candidates.map(async (a) => ({ agent: a, run: await this.safeShouldRun(a, enriched) })),
    )
    const toRun = decisions.filter((d) => d.run).map((d) => d.agent)
    const skippedAgentIds = decisions.filter((d) => !d.run).map((d) => d.agent.id)
    logger.info('agent selection', { run: toRun.map((a) => a.id), skipped: skippedAgentIds })

    // Step 3 — run in parallel, each isolated + timed out.
    const results = await Promise.all(toRun.map((a) => this.runAgent(a, enriched, timeout)))

    // Step 4 + 5 — synthesize across findings; total usage = analysis + agent
    // calls (e.g. Customer Voice retrieval) + synthesis.
    const { report, usage: synthUsage } = await synthesizer.synthesize(enriched, results)
    const agentUsage = results.reduce<TokenUsage | undefined>((acc, r) => addUsage(acc, r.usage), undefined)
    const usage = addUsage(addUsage(analyzeUsage, agentUsage), synthUsage)

    logger.info('synthesis decision', report.decision)
    return {
      analysis,
      results,
      report,
      ranAgentIds: toRun.map((a) => a.id),
      skippedAgentIds,
      usage,
      analyzeUsage,
      synthesisUsage: synthUsage,
    }
  }

  private async safeShouldRun(agent: Agent, ctx: AgentContext): Promise<boolean> {
    try {
      return await agent.shouldRun(ctx)
    } catch (e) {
      this.deps.logger.warn(`shouldRun failed for ${agent.id}; skipping`, errMsg(e))
      return false
    }
  }

  private async runAgent(agent: Agent, ctx: AgentContext, timeout: number): Promise<AgentResult> {
    const start = now()
    try {
      const result = await withTimeout(agent.execute(ctx), timeout, agent.id)
      return { ...result, durationMs: Math.round(now() - start) }
    } catch (e) {
      const isTimeout = e instanceof TimeoutError
      this.deps.logger.error(`agent ${agent.id} ${isTimeout ? 'timed out' : 'failed'}`, errMsg(e))
      return {
        agentId: agent.id,
        summary: `Agent ${isTimeout ? 'timed out' : 'failed'}: ${errMsg(e)}`,
        findings: [],
        confidence: 0,
        status: isTimeout ? 'timeout' : 'error',
        error: errMsg(e),
        durationMs: Math.round(now() - start),
      }
    }
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
