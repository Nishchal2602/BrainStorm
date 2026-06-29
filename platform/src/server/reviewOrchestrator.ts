import { prisma } from '@/lib/db'
import { config } from '@/lib/config'
import { getStorage } from '@/lib/storage'
import { recordEvent } from '@/server/timeline'
import { assertTransition, REVIEW_FLOW } from '@/server/stateMachines'
import {
  persistCompetitorLandscape,
  persistCustomerEvidence,
  persistPmReview,
  persistRecommendation,
  type PMReviewResult,
} from '@/server/persistence'
import { ClaudeLlmAdapter, type LlmPort } from '@/lib/agents/llm'
import { consoleLogger } from '@/lib/agents/logger'
import { DocumentAnalyzer } from '@/lib/agents/analyzer'
import { Synthesizer } from '@/lib/agents/synthesis'
import { CustomerVoiceAgent } from '@/lib/agents/agents/customerVoice'
import { CompetitorIntelligenceAgent } from '@/lib/agents/agents/competitor'
import { pmReview } from '@/lib/features/pmReview'
import type { AgentContext, AgentResult, CompetitorPayload, CustomerVoicePayload } from '@/lib/agents/types'
import type { Prisma, ReviewStatus } from '@/generated/prisma'
import type { Section } from '@/lib/types'

type StageKey = 'sharedAnalysis' | 'pmReview' | 'customerVoice' | 'competitor' | 'recommendation'
type StageState = 'pending' | 'running' | 'completed' | 'failed'
type AgentStatus = Record<StageKey, StageState>

const STAGES: StageKey[] = ['sharedAnalysis', 'pmReview', 'customerVoice', 'competitor', 'recommendation']

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Retry transient LLM errors once (per the plan's "retries where appropriate"). */
async function retry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      if (i < attempts - 1) await sleep(800)
    }
  }
  throw last
}

/** Map the reused PM Review prompt's parsed sections → the structured PMReviewResult. */
function mapPmReview(sections: Section[]): PMReviewResult {
  const bulletsFor = (needle: string): string[] =>
    sections.find((s) => s.heading.toLowerCase().includes(needle) && s.bullets?.length)?.bullets ?? []
  const insight = sections.find((s) => s.tone === 'insight' && s.body)
  return {
    summary: insight?.body ?? 'PM Review completed.',
    risks: bulletsFor('risk'),
    rolloutRisks: bulletsFor('implementation'),
    missingRequirements: bulletsFor('unknown'),
    openQuestions: bulletsFor('unknown'),
    suggestedExperiments: bulletsFor('if i were').length
      ? bulletsFor('if i were')
      : bulletsFor('recommend'),
    confidence: 0.7,
  }
}

export interface ReviewOrchestratorDeps {
  llm?: LlmPort
}

/**
 * Sequential review pipeline (per the Workflows + Agents PDFs): Shared Analysis →
 * PM Review → Customer Voice → Competitor → Recommendation. Reuses the vendored
 * Pocket PM agents unchanged; this layer only sequences, persists, and tracks status.
 */
export class ReviewOrchestrator {
  private readonly llm: LlmPort
  /** True when running on the real LLM backend (not an injected test fake). */
  private readonly requiresBackend: boolean
  private readonly analyzer: DocumentAnalyzer
  private readonly cv: CustomerVoiceAgent
  private readonly competitor: CompetitorIntelligenceAgent
  private readonly synth: Synthesizer

  constructor(deps: ReviewOrchestratorDeps = {}) {
    this.requiresBackend = !deps.llm
    this.llm = deps.llm ?? new ClaudeLlmAdapter('claude-sonnet-4-6')
    this.analyzer = new DocumentAnalyzer(this.llm, consoleLogger)
    this.cv = new CustomerVoiceAgent(consoleLogger, this.llm)
    this.competitor = new CompetitorIntelligenceAgent(consoleLogger, this.llm)
    this.synth = new Synthesizer(this.llm, consoleLogger)
  }

  async runReview(reviewRunId: string, actorId: string): Promise<void> {
    const run = await prisma.reviewRun.findUnique({ where: { id: reviewRunId } })
    if (!run) return
    const status: AgentStatus = Object.fromEntries(STAGES.map((s) => [s, 'pending'])) as AgentStatus

    const setStatus = (key: StageKey, state: StageState) =>
      this.persistStatus(reviewRunId, { ...status, [key]: (status[key] = state) })

    try {
      if (this.requiresBackend && !config.hasBackend) {
        throw new Error(
          'No AI backend configured — set GEMINI_API_KEY in platform/.env, then restart `npm run dev`.',
        )
      }
      const { document, productName, industry, featureName, productId, featureId } =
        await this.loadContext(reviewRunId)

      await this.transition(reviewRunId, run.status, 'Running')
      await this.persistStatus(reviewRunId, status)
      await this.event(reviewRunId, productId, 'Review Started', actorId)

      const ctx: AgentContext = {
        document,
        productName,
        industry,
        featureName,
        metadata: {
          reviewContext: {
            featureName: featureName ?? '',
            problemStatement: '',
            targetUser: '',
            successMetric: '',
            reviewType: 'product_strategy',
            familiarityLevel: 'some_knowledge',
          },
          clientId: actorId,
        },
      }

      // 1 — Shared Document Analysis (persisted on the run; feeds every later stage).
      await setStatus('sharedAnalysis', 'running')
      const { analysis } = await retry(() => this.analyzer.analyze(ctx))
      await prisma.reviewRun.update({
        where: { id: reviewRunId },
        data: { sharedAnalysis: analysis as unknown as Prisma.InputJsonValue },
      })
      ctx.industry = ctx.industry || analysis.industry
      ctx.productType = analysis.productCategory
      ctx.metadata = { ...ctx.metadata, analysis }
      await setStatus('sharedAnalysis', 'completed')

      const results: AgentResult[] = []

      // 2 — PM Review (reuse the existing PM Review prompt; soft-fail).
      await this.stage('pmReview', setStatus, async () => {
        const pm = await retry(() => this.runPmReview(ctx))
        await prisma.$transaction((tx) => persistPmReview(tx, reviewRunId, pm))
      })

      // 3 — Customer Voice (agent is non-throwing).
      await this.stage('customerVoice', setStatus, async () => {
        const res = (await this.cv.execute(ctx)) as AgentResult<CustomerVoicePayload>
        results.push(res)
        if (res.data) {
          await prisma.$transaction((tx) =>
            persistCustomerEvidence(tx, reviewRunId, res.data!, res.findings),
          )
        }
        if (res.status !== 'ok') throw new Error(res.error || 'customer voice error')
      })

      // 4 — Competitor Intelligence.
      await this.stage('competitor', setStatus, async () => {
        const res = (await this.competitor.execute(ctx)) as AgentResult<CompetitorPayload>
        results.push(res)
        if (res.data) {
          await prisma.$transaction((tx) =>
            persistCompetitorLandscape(tx, reviewRunId, productId, res.data!, res.findings),
          )
        }
        if (res.status !== 'ok') throw new Error(res.error || 'competitor error')
      })

      // 5 — Recommendation Engine (terminal output; failure here fails the run).
      await setStatus('recommendation', 'running')
      const { report } = await retry(() => this.synth.synthesize(ctx, results))
      await prisma.$transaction(async (tx) => {
        await persistRecommendation(tx, reviewRunId, productId, featureId, actorId, report)
        await recordEvent(tx, {
          productId,
          entityType: 'ReviewRun',
          entityId: reviewRunId,
          eventType: 'Recommendation Created',
          actorId,
          metadata: { recommendation: report.decision.recommendation },
        })
      })
      await setStatus('recommendation', 'completed')

      await this.transition(reviewRunId, 'Running', 'Completed')
      await this.event(reviewRunId, productId, 'Review Completed', actorId, {
        recommendation: report.decision.recommendation,
      })
    } catch (e) {
      consoleLogger.error('review orchestration failed', e instanceof Error ? e.message : e)
      const fresh = await prisma.reviewRun.findUnique({ where: { id: reviewRunId } })
      if (fresh && (fresh.status === 'Running' || fresh.status === 'Pending')) {
        await prisma.reviewRun
          .update({ where: { id: reviewRunId }, data: { status: 'Failed', completedAt: new Date() } })
          .catch(() => {})
        await this.event(reviewRunId, fresh.productId, 'Review Failed', actorId, {
          error: e instanceof Error ? e.message : String(e),
        }).catch(() => {})
      }
    }
  }

  /** Run a soft-fail stage: mark running → completed, or failed (recorded, pipeline continues). */
  private async stage(
    key: StageKey,
    setStatus: (k: StageKey, s: StageState) => Promise<void>,
    fn: () => Promise<void>,
  ): Promise<void> {
    await setStatus(key, 'running')
    try {
      await fn()
      await setStatus(key, 'completed')
    } catch (e) {
      consoleLogger.warn(`stage ${key} failed`, e instanceof Error ? e.message : e)
      await setStatus(key, 'failed')
    }
  }

  private async runPmReview(ctx: AgentContext): Promise<PMReviewResult> {
    const user = `${ctx.document}\n\nReview the document above and produce the structured PM Review.`
    const { text, sources } = await this.llm.generateText({
      system: pmReview.systemInstructions,
      user,
      webSearch: { maxUses: 8 },
      maxTokens: 6000,
      label: 'pm_review',
      meta: ctx.metadata?.clientId ? { clientId: String(ctx.metadata.clientId) } : undefined,
    })
    return mapPmReview(pmReview.parse(text, sources).sections)
  }

  private async loadContext(reviewRunId: string) {
    const run = await prisma.reviewRun.findUniqueOrThrow({
      where: { id: reviewRunId },
      include: { product: true, feature: true },
    })
    const prd = run.prdId
      ? await prisma.pRD.findUnique({ where: { id: run.prdId } })
      : run.feature?.currentPrdId
        ? await prisma.pRD.findUnique({ where: { id: run.feature.currentPrdId } })
        : null
    if (!prd?.documentFileId) throw new Error('No PRD document attached to this review')
    const file = await prisma.file.findUniqueOrThrow({ where: { id: prd.documentFileId } })
    const bytes = await getStorage().get(file.storagePath)
    const document = bytes.toString('utf8')
    if (!document.trim()) throw new Error('PRD document is empty or not text-readable')
    return {
      document,
      productName: run.product.name,
      industry: undefined as string | undefined,
      featureName: run.feature?.name,
      productId: run.productId,
      featureId: run.featureId,
    }
  }

  private async persistStatus(reviewRunId: string, status: AgentStatus): Promise<void> {
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
