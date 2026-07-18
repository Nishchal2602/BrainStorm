import { prisma } from '@/lib/db'
import { config } from '@/lib/config'
import { getStorage } from '@/lib/storage'
import { recordEvent } from '@/server/timeline'
import { assertTransition, REVIEW_FLOW } from '@/server/stateMachines'
import { extractDocumentText } from '@/server/documentText'
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
import { PmReviewAgent } from '@/lib/agents/agents/pmReview'
import { withTimeout } from '@/lib/agents/runtime'
import type { ReadinessReview } from '@/lib/features/pmReview'
import type {
  AgentContext,
  AgentResult,
  CompetitorPayload,
  CustomerVoicePayload,
  PmReviewAgentPayload,
} from '@/lib/agents/types'
import type { Prisma, ReviewStatus } from '@/generated/prisma'

type StageKey = 'sharedAnalysis' | 'pmReview' | 'customerVoice' | 'competitor' | 'recommendation'
type StageState = 'pending' | 'running' | 'completed' | 'failed'
type AgentStatus = Record<StageKey, StageState>

const STAGES: StageKey[] = ['sharedAnalysis', 'pmReview', 'customerVoice', 'competitor', 'recommendation']

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A rate-limit / overload error surfaced by the Gemini transport — the transport
 *  already backs off and retries these, so the orchestrator must NOT re-fire them
 *  (a second attempt just hammers the same per-minute limit). */
function isRateLimit(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /rate limit|429|overloaded|503|quota/i.test(msg)
}

/** Retry a genuinely transient LLM error once. Rate-limit errors are excluded —
 *  the transport owns 429 backoff; retrying here only amplifies the limit. */
async function retry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      if (isRateLimit(e) || i >= attempts - 1) break
      await sleep(1500)
    }
  }
  throw last
}

/** Per-stage budget — a hung LLM/grounding call fails the stage instead of hanging
 *  the run. 90s gives Haiku headroom for the web-grounded competitor call. */
const STAGE_TIMEOUT_MS = 90_000

const CONFIDENCE_NUM: Record<string, number> = { High: 0.9, Medium: 0.6, Low: 0.35 }

/** Map the Staff-PM readiness review (XML agent output) → the structured PMReviewResult.
 *  Same DB shape as before — only the producer changed (mirrored in lemma/reviewStages). */
function mapPmReview(review: ReadinessReview): PMReviewResult {
  const summary = [
    review.decision ? `${review.decision}` : 'PM Review completed',
    review.readiness != null ? `— PRD readiness ${review.readiness}/100.` : '.',
    review.rationale ?? '',
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return {
    summary,
    risks: [...review.critical, ...review.medium].map((i) => i.title),
    rolloutRisks: review.missingNfrs,
    missingRequirements: review.missingRequirements,
    openQuestions: [...review.productQuestions, ...review.engineeringQuestions],
    suggestedExperiments: review.minor.map((i) => i.title),
    confidence: review.reviewerConfidence ? CONFIDENCE_NUM[review.reviewerConfidence] ?? 0.6 : 0.6,
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
  private readonly pm: PmReviewAgent
  private readonly cv: CustomerVoiceAgent
  private readonly competitor: CompetitorIntelligenceAgent
  private readonly synth: Synthesizer

  constructor(deps: ReviewOrchestratorDeps = {}) {
    this.requiresBackend = !deps.llm
    this.llm = deps.llm ?? new ClaudeLlmAdapter('claude-sonnet-4-6')
    this.analyzer = new DocumentAnalyzer(this.llm, consoleLogger)
    this.pm = new PmReviewAgent(consoleLogger, this.llm)
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
          'No AI backend configured — set ANTHROPIC_API_KEY (or GEMINI_API_KEY) in platform/.env, then restart `npm run dev`.',
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
          // Server-side, Reddit is throttled for datacenter IPs, so Customer Voice's
          // grounded web-search fallback is its main evidence source here — keep it
          // ENABLED so CV returns real evidence instead of "insufficient." It's
          // surfaced at reduced confidence (see the CV agent), and web search works
          // on Haiku via allowed_callers:['direct'] in the transport.
          skipGroundedFallback: false,
        },
      }

      // 1 — Shared Document Analysis (persisted on the run; feeds every later stage).
      await setStatus('sharedAnalysis', 'running')
      const { analysis } = await retry(() =>
        withTimeout(this.analyzer.analyze(ctx), STAGE_TIMEOUT_MS, 'analyze'),
      )
      await prisma.reviewRun.update({
        where: { id: reviewRunId },
        data: { sharedAnalysis: analysis as unknown as Prisma.InputJsonValue },
      })
      ctx.industry = ctx.industry || analysis.industry
      ctx.productType = analysis.productCategory
      ctx.metadata = { ...ctx.metadata, analysis }
      await setStatus('sharedAnalysis', 'completed')

      const results: AgentResult[] = []

      // 2 — PM Review (the Staff-PM readiness agent — document-internal, no web
      // search; soft-fail). Its findings join `results` so synthesis weighs them.
      await this.stage('pmReview', setStatus, async () => {
        const res = (await withTimeout(
          this.pm.execute(ctx),
          STAGE_TIMEOUT_MS,
          'pm_review',
        )) as AgentResult<PmReviewAgentPayload>
        results.push(res)
        if (res.data?.review) {
          const pm = mapPmReview(res.data.review)
          await prisma.$transaction((tx) => persistPmReview(tx, reviewRunId, pm))
        }
        if (res.status !== 'ok') throw new Error(res.error || 'pm review error')
      })

      // 3 — Customer Voice (agent is non-throwing).
      await this.stage('customerVoice', setStatus, async () => {
        const res = (await withTimeout(
          this.cv.execute(ctx),
          STAGE_TIMEOUT_MS,
          'customer_voice',
        )) as AgentResult<CustomerVoicePayload>
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
        const res = (await withTimeout(
          this.competitor.execute(ctx),
          STAGE_TIMEOUT_MS,
          'competitor',
        )) as AgentResult<CompetitorPayload>
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
      const { report } = await retry(() =>
        withTimeout(this.synth.synthesize(ctx, results), STAGE_TIMEOUT_MS, 'synthesis'),
      )
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
    const document = await extractDocumentText(bytes, { mimeType: file.mimeType, fileName: file.fileName })
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
