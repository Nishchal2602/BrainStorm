import { prisma } from '@/lib/db'
import { getStorage } from '@/lib/storage'
import { recordEvent } from '@/server/timeline'
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
import { pmReview } from '@/lib/features/pmReview'
import type { AgentContext, AgentResult, CompetitorPayload, CustomerVoicePayload } from '@/lib/agents/types'
import type { Prisma } from '@/generated/prisma'
import type { Section } from '@/lib/types'

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
  const document = (await getStorage().get(file.storagePath)).toString('utf8')
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
    },
  }
  return { ctx, productId: run.productId, featureId: run.featureId, productName: run.product.name }
}

/** Mirror of the orchestrator's mapPmReview. */
export function mapPmReview(sections: Section[]): PMReviewResult {
  const bulletsFor = (needle: string): string[] =>
    sections.find((s) => s.heading.toLowerCase().includes(needle) && s.bullets?.length)?.bullets ?? []
  const insight = sections.find((s) => s.tone === 'insight' && s.body)
  return {
    summary: insight?.body ?? 'PM Review completed.',
    risks: bulletsFor('risk'),
    rolloutRisks: bulletsFor('implementation'),
    missingRequirements: bulletsFor('unknown'),
    openQuestions: bulletsFor('unknown'),
    suggestedExperiments: bulletsFor('if i were').length ? bulletsFor('if i were') : bulletsFor('recommend'),
    confidence: 0.7,
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
  private readonly cv: CustomerVoiceAgent
  private readonly competitorAgent: CompetitorIntelligenceAgent
  private readonly synth: Synthesizer
  private readonly results: AgentResult[] = []

  constructor(private readonly llm: LlmPort) {
    this.analyzer = new DocumentAnalyzer(this.llm, consoleLogger)
    this.cv = new CustomerVoiceAgent(consoleLogger, this.llm)
    this.competitorAgent = new CompetitorIntelligenceAgent(consoleLogger, this.llm)
    this.synth = new Synthesizer(this.llm, consoleLogger)
  }

  /** Shared Document Analysis → persisted on the run; mutates ctx for later stages. */
  async sharedAnalysis(reviewRunId: string, ctx: AgentContext): Promise<void> {
    const { analysis } = await this.analyzer.analyze(ctx)
    await prisma.reviewRun.update({
      where: { id: reviewRunId },
      data: { sharedAnalysis: analysis as unknown as Prisma.InputJsonValue },
    })
    ctx.industry = ctx.industry || analysis.industry
    ctx.productType = analysis.productCategory
    ctx.metadata = { ...ctx.metadata, analysis }
  }

  async pmReview(reviewRunId: string, ctx: AgentContext): Promise<void> {
    const user = `${ctx.document}\n\nReview the document above and produce the structured PM Review.`
    const { text, sources } = await this.llm.generateText({
      system: pmReview.systemInstructions,
      user,
      webSearch: { maxUses: 8 },
      maxTokens: 6000,
      label: 'pm_review',
      meta: ctx.metadata?.clientId ? { clientId: String(ctx.metadata.clientId) } : undefined,
    })
    const pm = mapPmReview(pmReview.parse(text, sources).sections)
    await prisma.$transaction((tx) => persistPmReview(tx, reviewRunId, pm))
  }

  async customerVoice(reviewRunId: string, ctx: AgentContext): Promise<void> {
    const res = (await this.cv.execute(ctx)) as AgentResult<CustomerVoicePayload>
    this.results.push(res)
    if (res.data) {
      await prisma.$transaction((tx) => persistCustomerEvidence(tx, reviewRunId, res.data!, res.findings))
    }
    if (res.status !== 'ok') throw new Error(res.error || 'customer voice error')
  }

  async competitor(reviewRunId: string, productId: string, ctx: AgentContext): Promise<void> {
    const res = (await this.competitorAgent.execute(ctx)) as AgentResult<CompetitorPayload>
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
    const { report } = await this.synth.synthesize(ctx, this.results)
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
