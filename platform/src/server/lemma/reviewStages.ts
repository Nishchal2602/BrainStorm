import { prisma } from '@/lib/db'
import { getStorage } from '@/lib/storage'
import { recordEvent } from '@/server/timeline'
import { extractDocumentText } from '@/server/documentText'
import {
  persistCompetitorLandscape,
  persistCustomerEvidence,
  persistPmReview,
  persistRecommendation,
  type PMReviewResult,
} from '@/server/persistence'
import type { LlmPort } from '@/lib/agents/llm'
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
import type { Prisma } from '@/generated/prisma'

/** Per-stage budget — a hung LLM/grounding call fails the stage instead of hanging
 *  the run. 90s gives Haiku headroom for the web-grounded competitor call. */
const STAGE_TIMEOUT_MS = 90_000

/**
 * Reusable review-stage helpers shared by the Lemma runner. The existing
 * `reviewOrchestrator.ts` is intentionally left untouched (it keeps its own
 * private copies); this module mirrors that logic so the agents + persistence
 * functions are reused VERBATIM — only the sequencing differs (Lemma gates it).
 */

export interface LoadedReview {
  ctx: AgentContext
  productId: string
  featureId: string | null
  productName: string
}

/** Mirror of the orchestrator's loadContext + AgentContext construction. */
export async function loadReviewContext(reviewRunId: string, actorId: string): Promise<LoadedReview> {
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

  const featureName = run.feature?.name
  const ctx: AgentContext = {
    document,
    productName: run.product.name,
    industry: undefined,
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
      // Server-side: keep CV's grounded web-search fallback ENABLED (see
      // reviewOrchestrator) so CV has an evidence source when server Reddit is
      // empty; surfaced at reduced confidence by the CV agent.
      skipGroundedFallback: false,
    },
  }
  return { ctx, productId: run.productId, featureId: run.featureId, productName: run.product.name }
}

const CONFIDENCE_NUM: Record<string, number> = { High: 0.9, Medium: 0.6, Low: 0.35 }

/** Map the Staff-PM readiness review (XML agent output) → the persisted PMReviewResult.
 *  Same DB shape as before — only the producer changed (mirrored by the orchestrator). */
export function mapPmReview(review: ReadinessReview): PMReviewResult {
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

/**
 * Holds the agents + accumulated agent results for one review and runs a single
 * stage at a time (so a Lemma FORM node can gate each). Reuses the existing agent
 * classes + persistence functions verbatim. Stages throw on error; the caller
 * (LemmaReviewRunner) decides soft- vs hard-fail per stage, mirroring the orchestrator.
 */
export class ReviewStages {
  private readonly analyzer: DocumentAnalyzer
  private readonly pm: PmReviewAgent
  private readonly cv: CustomerVoiceAgent
  private readonly competitorAgent: CompetitorIntelligenceAgent
  private readonly synth: Synthesizer
  private readonly results: AgentResult[] = []

  constructor(private readonly llm: LlmPort) {
    this.analyzer = new DocumentAnalyzer(this.llm, consoleLogger)
    this.pm = new PmReviewAgent(consoleLogger, this.llm)
    this.cv = new CustomerVoiceAgent(consoleLogger, this.llm)
    this.competitorAgent = new CompetitorIntelligenceAgent(consoleLogger, this.llm)
    this.synth = new Synthesizer(this.llm, consoleLogger)
  }

  /** Shared Document Analysis → persisted on the run; mutates ctx for later stages. */
  async sharedAnalysis(reviewRunId: string, ctx: AgentContext): Promise<void> {
    const { analysis } = await withTimeout(this.analyzer.analyze(ctx), STAGE_TIMEOUT_MS, 'analyze')
    await prisma.reviewRun.update({
      where: { id: reviewRunId },
      data: { sharedAnalysis: analysis as unknown as Prisma.InputJsonValue },
    })
    ctx.industry = ctx.industry || analysis.industry
    ctx.productType = analysis.productCategory
    ctx.metadata = { ...ctx.metadata, analysis }
  }

  /** PM Review — the Staff-PM readiness agent (document-internal, no web search).
   *  Its findings join `results` so synthesis weighs execution readiness. */
  async pmReview(reviewRunId: string, ctx: AgentContext): Promise<void> {
    const res = (await withTimeout(
      this.pm.execute(ctx),
      STAGE_TIMEOUT_MS,
      'pm_review',
    )) as AgentResult<PmReviewAgentPayload>
    this.results.push(res)
    if (res.data?.review) {
      const pm = mapPmReview(res.data.review)
      await prisma.$transaction((tx) => persistPmReview(tx, reviewRunId, pm))
    }
    if (res.status !== 'ok') throw new Error(res.error || 'pm review error')
  }

  async customerVoice(reviewRunId: string, ctx: AgentContext): Promise<void> {
    const res = (await withTimeout(
      this.cv.execute(ctx),
      STAGE_TIMEOUT_MS,
      'customer_voice',
    )) as AgentResult<CustomerVoicePayload>
    this.results.push(res)
    if (res.data) {
      await prisma.$transaction((tx) => persistCustomerEvidence(tx, reviewRunId, res.data!, res.findings))
    }
    if (res.status !== 'ok') throw new Error(res.error || 'customer voice error')
  }

  async competitor(reviewRunId: string, productId: string, ctx: AgentContext): Promise<void> {
    const res = (await withTimeout(
      this.competitorAgent.execute(ctx),
      STAGE_TIMEOUT_MS,
      'competitor',
    )) as AgentResult<CompetitorPayload>
    this.results.push(res)
    if (res.data) {
      await prisma.$transaction((tx) => persistCompetitorLandscape(tx, reviewRunId, productId, res.data!, res.findings))
    }
    if (res.status !== 'ok') throw new Error(res.error || 'competitor error')
  }

  /** Recommendation Engine (terminal) → ReviewRun.recommendation + Decision (Proposed) + timeline. */
  async recommendation(
    reviewRunId: string,
    productId: string,
    featureId: string | null,
    actorId: string,
    ctx: AgentContext,
  ): Promise<void> {
    const { report } = await withTimeout(this.synth.synthesize(ctx, this.results), STAGE_TIMEOUT_MS, 'synthesis')
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
  }
}
