import { prisma } from '@/lib/db'
import { config } from '@/lib/config'
import { recordEvent } from '@/server/timeline'
import { assertTransition, REVIEW_FLOW } from '@/server/stateMachines'
import { ReviewOrchestrator } from '@/server/reviewOrchestrator'
import { ClaudeLlmAdapter, type LlmPort } from '@/lib/agents/llm'
import { consoleLogger } from '@/lib/agents/logger'
import type { Prisma, ReviewStatus } from '@/generated/prisma'
import { lemmaConfig } from './config'
import { LemmaWorkflowClient } from './client'
import { TERMINAL, type LemmaClientPort, type LemmaRunView } from './port'
import { ReviewStages, loadReviewContext, type LoadedReview } from './reviewStages'

type StageKey = 'sharedAnalysis' | 'pmReview' | 'customerVoice' | 'competitor' | 'recommendation'
const STAGES: StageKey[] = ['sharedAnalysis', 'pmReview', 'customerVoice', 'competitor', 'recommendation']
const STAGE_SET = new Set<string>(STAGES)
// Mirror the orchestrator: the three middle stages soft-fail (recorded, pipeline
// continues); sharedAnalysis (feeds all) and recommendation (terminal) are hard-fail.
const SOFT_FAIL = new Set<StageKey>(['pmReview', 'customerVoice', 'competitor'])
const STAGE_DONE_EVENT: Partial<Record<StageKey, string>> = {
  pmReview: 'PM Review Completed',
  customerVoice: 'Customer Voice Completed',
  competitor: 'Competitor Completed',
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface LemmaReviewRunnerDeps {
  llm?: LlmPort
  lemma?: LemmaClientPort
}

/**
 * Runs a review as a REAL Lemma workflow (the "shell" model): a Lemma run sequences
 * the five FORM-gated steps; this runner executes the existing Pocket PM agents in-app
 * for each step, persists via the existing persistence layer, and advances the Lemma
 * run with submitForm. Same entry signature as ReviewOrchestrator so the endpoint can
 * pick either. The orchestrator is left intact and is the automatic fallback.
 */
export class LemmaReviewRunner {
  private readonly llm: LlmPort
  private readonly injectedLlm?: LlmPort
  private readonly lemma: LemmaClientPort
  private readonly requiresBackend: boolean

  constructor(deps: LemmaReviewRunnerDeps = {}) {
    this.requiresBackend = !deps.llm
    this.injectedLlm = deps.llm
    this.llm = deps.llm ?? new ClaudeLlmAdapter('claude-sonnet-4-6')
    this.lemma = deps.lemma ?? new LemmaWorkflowClient()
  }

  async runReview(reviewRunId: string, actorId: string): Promise<void> {
    const run = await prisma.reviewRun.findUnique({ where: { id: reviewRunId } })
    if (!run) return

    // Preflight: no AI backend → fail clearly (orchestrator fallback would fail identically).
    if (this.requiresBackend && !config.hasBackend) {
      await this.failRun(
        reviewRunId,
        run.productId,
        actorId,
        'No AI backend configured — set ANTHROPIC_API_KEY (or GEMINI_API_KEY) in platform/.env, then restart `npm run dev`.',
      )
      return
    }

    // Load the PRD/context up front — a missing PRD is a real error (don't start a Lemma run for it).
    let loaded: LoadedReview
    try {
      loaded = await loadReviewContext(reviewRunId, actorId)
    } catch (e) {
      await this.failRun(reviewRunId, run.productId, actorId, msg(e))
      return
    }

    // Start the Lemma workflow run. If Lemma is unreachable/misconfigured, fall back to the
    // existing in-process orchestrator — nothing has been persisted yet, so this is seamless.
    let started: LemmaRunView
    try {
      started = await this.lemma.startRun(lemmaConfig.workflowName)
    } catch (e) {
      consoleLogger.warn('Lemma unavailable at start; using in-process orchestrator', msg(e))
      await new ReviewOrchestrator(this.injectedLlm ? { llm: this.injectedLlm } : {}).runReview(reviewRunId, actorId)
      return
    }

    const status: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s, 'pending']))
    const stages = new ReviewStages(this.llm)
    try {
      await this.transition(reviewRunId, run.status, 'Running')
      status.__engine = 'lemma'
      status.__lemmaRunId = started.id
      await this.persistStatus(reviewRunId, status)
      await this.event(reviewRunId, loaded.productId, 'Review Started', actorId, {
        engine: 'lemma',
        lemmaRunId: started.id,
      })

      // Drive the run: for each FORM the workflow waits on, run that agent + persist, then submit.
      let view = started
      let polls = 0
      while (!TERMINAL.has(view.status)) {
        if (polls++ > lemmaConfig.maxPolls) throw new Error('Lemma run exceeded poll budget')
        if (view.status === 'WAITING' && view.waitingNodeId) {
          if (STAGE_SET.has(view.waitingNodeId)) {
            await this.runStage(view.waitingNodeId as StageKey, stages, loaded, reviewRunId, actorId, status)
          }
          // Advance past this node (its work is done or soft-failed). submitForm gates ordering.
          view = await this.lemma.submitForm(view.id, view.waitingNodeId, { ok: true })
          continue
        }
        await sleep(lemmaConfig.pollIntervalMs)
        view = await this.lemma.getRun(view.id)
      }

      if (view.status !== 'COMPLETED') {
        throw new Error(`Lemma run ${view.status}${view.error ? `: ${view.error}` : ''}`)
      }

      await this.transition(reviewRunId, 'Running', 'Completed')
      await this.event(reviewRunId, loaded.productId, 'Review Completed', actorId, {
        engine: 'lemma',
        lemmaRunId: started.id,
      })
    } catch (e) {
      consoleLogger.error('lemma review orchestration failed', msg(e))
      await this.lemma.cancel(started.id).catch(() => {})
      const fresh = await prisma.reviewRun.findUnique({ where: { id: reviewRunId } })
      if (fresh && (fresh.status === 'Running' || fresh.status === 'Pending')) {
        await prisma.reviewRun
          .update({ where: { id: reviewRunId }, data: { status: 'Failed', completedAt: new Date() } })
          .catch(() => {})
        await this.event(reviewRunId, fresh.productId, 'Review Failed', actorId, { error: msg(e) }).catch(() => {})
      }
    }
  }

  /** Run one stage (matching the waiting node) + update agentStatus + per-stage timeline event. */
  private async runStage(
    node: StageKey,
    stages: ReviewStages,
    loaded: LoadedReview,
    reviewRunId: string,
    actorId: string,
    status: Record<string, string>,
  ): Promise<void> {
    await this.setStatus(reviewRunId, status, node, 'running')
    try {
      switch (node) {
        case 'sharedAnalysis':
          await stages.sharedAnalysis(reviewRunId, loaded.ctx)
          break
        case 'pmReview':
          await stages.pmReview(reviewRunId, loaded.ctx)
          break
        case 'customerVoice':
          await stages.customerVoice(reviewRunId, loaded.ctx)
          break
        case 'competitor':
          await stages.competitor(reviewRunId, loaded.productId, loaded.ctx)
          break
        case 'recommendation':
          await stages.recommendation(reviewRunId, loaded.productId, loaded.featureId, actorId, loaded.ctx)
          break
      }
      await this.setStatus(reviewRunId, status, node, 'completed')
      const ev = STAGE_DONE_EVENT[node]
      if (ev) await this.event(reviewRunId, loaded.productId, ev, actorId)
    } catch (e) {
      consoleLogger.warn(`lemma stage ${node} failed`, msg(e))
      await this.setStatus(reviewRunId, status, node, 'failed')
      if (!SOFT_FAIL.has(node)) throw e
    }
  }

  private async setStatus(
    reviewRunId: string,
    status: Record<string, string>,
    key: StageKey,
    state: string,
  ): Promise<void> {
    status[key] = state
    await this.persistStatus(reviewRunId, status)
  }

  private async persistStatus(reviewRunId: string, status: Record<string, string>): Promise<void> {
    await prisma.reviewRun.update({
      where: { id: reviewRunId },
      data: { agentStatus: status as unknown as Prisma.InputJsonValue },
    })
  }

  private async transition(reviewRunId: string, from: ReviewStatus, to: ReviewStatus): Promise<void> {
    assertTransition(REVIEW_FLOW, from, to, 'review run status')
    await prisma.reviewRun.update({
      where: { id: reviewRunId },
      data: {
        status: to,
        ...(to === 'Running' ? { startedAt: new Date() } : {}),
        ...(to === 'Completed' || to === 'Failed' ? { completedAt: new Date() } : {}),
      },
    })
  }

  private async failRun(reviewRunId: string, productId: string, actorId: string, error: string): Promise<void> {
    await prisma.reviewRun
      .update({ where: { id: reviewRunId }, data: { status: 'Failed', completedAt: new Date() } })
      .catch(() => {})
    await this.event(reviewRunId, productId, 'Review Failed', actorId, { error }).catch(() => {})
  }

  private async event(
    reviewRunId: string,
    productId: string,
    eventType: string,
    actorId: string,
    metadata?: Prisma.InputJsonValue,
  ): Promise<void> {
    await recordEvent(prisma, {
      productId,
      entityType: 'ReviewRun',
      entityId: reviewRunId,
      eventType,
      actorId,
      metadata,
    })
  }
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
