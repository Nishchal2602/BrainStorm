import { prisma } from '@/lib/db'
import type { Prisma } from '@/generated/prisma'
import {
  AgentType,
  EvidenceVerdict,
  FindingSeverity,
  FindingType,
  ReviewRecommendation,
} from '@/generated/prisma'
import type {
  BuildDecision,
  CompetitorPayload,
  CustomerVoicePayload,
  Finding,
  SynthesisReport,
} from '@/lib/agents/types'

type Tx = Prisma.TransactionClient

// ----------------------------- enum maps -----------------------------
const RECOMMENDATION_MAP: Record<BuildDecision, ReviewRecommendation> = {
  build: ReviewRecommendation.Build,
  build_with_changes: ReviewRecommendation.BuildWithChanges,
  validate_first: ReviewRecommendation.ValidateFirst,
  do_not_build: ReviewRecommendation.DoNotBuild,
}

const VERDICT_MAP: Record<string, EvidenceVerdict> = {
  supported: EvidenceVerdict.Supported,
  mixed: EvidenceVerdict.Mixed,
  contradicted: EvidenceVerdict.Contradicted,
  insufficient_evidence: EvidenceVerdict.NoEvidence,
}

function findingType(kind: string | undefined): FindingType {
  switch (kind) {
    case 'support':
      return FindingType.Opportunity
    case 'insight':
      return FindingType.Insight
    case 'assumption':
      return FindingType.Assumption
    case 'gap':
    case 'risk':
    case 'contradict':
    case 'edge_case':
      return FindingType.Risk
    default:
      return FindingType.Insight
  }
}

function findingSeverity(sev: string | undefined): FindingSeverity {
  return sev === 'high' ? FindingSeverity.High : sev === 'low' ? FindingSeverity.Low : FindingSeverity.Medium
}

const json = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue

// ----------------------------- findings -----------------------------
/** Persist a set of normalized findings under a review run (agent-tagged). */
export async function persistFindings(
  tx: Tx,
  reviewRunId: string,
  agent: AgentType,
  findings: Finding[],
): Promise<void> {
  if (!findings.length) return
  await tx.finding.createMany({
    data: findings.slice(0, 20).map((f) => ({
      reviewRunId,
      agent,
      type: findingType(f.kind),
      severity: findingSeverity(f.severity),
      title: f.title.slice(0, 300),
      description: f.detail || null,
      evidence: f.evidence ? json(f.evidence) : undefined,
      confidence: f.confidence ?? null,
    })),
  })
}

// ----------------------------- PM Review -----------------------------
export interface PMReviewResult {
  summary: string
  risks: string[]
  missingRequirements: string[]
  openQuestions: string[]
  rolloutRisks: string[]
  suggestedExperiments: string[]
  confidence: number
}

export async function persistPmReview(
  tx: Tx,
  reviewRunId: string,
  r: PMReviewResult,
): Promise<void> {
  await tx.pMReview.create({
    data: {
      reviewRunId,
      summary: r.summary || null,
      risks: json(r.risks),
      missingRequirements: json(r.missingRequirements),
      openQuestions: json(r.openQuestions),
      rolloutRisks: json(r.rolloutRisks),
      suggestedExperiments: json(r.suggestedExperiments),
    },
  })
  const findings: Finding[] = [
    ...r.risks.map((t) => ({ title: t, detail: '', kind: 'risk' as const })),
    ...r.missingRequirements.map((t) => ({ title: t, detail: 'Missing requirement', kind: 'gap' as const })),
    ...r.openQuestions.map((t) => ({ title: t, detail: '', kind: 'assumption' as const })),
  ]
  await persistFindings(tx, reviewRunId, AgentType.PMReview, findings)
}

// ----------------------------- Customer Voice -----------------------------
export async function persistCustomerEvidence(
  tx: Tx,
  reviewRunId: string,
  payload: CustomerVoicePayload,
  findings: Finding[],
): Promise<void> {
  for (const h of payload.hypotheses) {
    await tx.customerEvidence.create({
      data: {
        reviewRunId,
        claim: h.statement,
        verdict: VERDICT_MAP[h.verdict] ?? EvidenceVerdict.NoEvidence,
        confidence: h.confidence / 100,
        supportingCount: h.supportingCount,
        contradictingCount: h.contradictingCount,
        sources: json(payload.distinctSubreddits),
        supportingQuotes: json(h.supporting.map((e) => ({ quote: e.quote, url: e.url, subreddit: e.subreddit }))),
        contradictingQuotes: json(h.contradicting.map((e) => ({ quote: e.quote, url: e.url, subreddit: e.subreddit }))),
      },
    })
  }
  await persistFindings(tx, reviewRunId, AgentType.CustomerVoice, findings)
}

// ----------------------------- Competitor -----------------------------
export async function persistCompetitorLandscape(
  tx: Tx,
  reviewRunId: string,
  productId: string,
  payload: CompetitorPayload,
  findings: Finding[],
): Promise<void> {
  for (const c of payload.landscape.competitors) {
    const existing = await tx.competitor.findFirst({ where: { productId, name: c.name } })
    const competitor = existing
      ? await tx.competitor.update({
          where: { id: existing.id },
          data: {
            website: c.url || existing.website,
            category: c.category || existing.category,
            positioning: c.positioning || existing.positioning,
            confidence: c.confidence / 100,
            lastSeen: new Date(),
          },
        })
      : await tx.competitor.create({
          data: {
            productId,
            name: c.name,
            website: c.url || null,
            category: c.category || null,
            positioning: c.positioning || null,
            confidence: c.confidence / 100,
          },
        })
    await tx.competitorSnapshot.create({
      data: {
        reviewRunId,
        competitorId: competitor.id,
        capabilities: json(c.capabilities.map((cap) => ({ name: cap.name, ...cap.evidence }))),
        strengths: json(c.strengths),
        weaknesses: json(c.weaknesses),
        differentiationScore: payload.differentiationScore,
      },
    })
  }
  await persistFindings(tx, reviewRunId, AgentType.Competitor, findings)
}

// ----------------------------- Recommendation -----------------------------
/** Persist the recommendation onto the ReviewRun + a Decision (Proposed) + findings (per Workflow 5). */
export async function persistRecommendation(
  tx: Tx,
  reviewRunId: string,
  productId: string,
  featureId: string | null,
  ownerId: string,
  report: SynthesisReport,
): Promise<void> {
  const recommendation = RECOMMENDATION_MAP[report.decision.recommendation] ?? null
  await tx.reviewRun.update({
    where: { id: reviewRunId },
    data: { recommendation, confidence: report.decision.confidence },
  })
  await tx.decision.create({
    data: {
      productId,
      featureId,
      reviewRunId,
      title: report.recommendation || report.finalVerdict || 'Recommendation',
      decision: report.executiveSummary || report.finalVerdict || report.recommendation,
      rationale: report.decision.rationale.join('\n'),
      confidence: report.decision.confidence,
      status: 'Proposed',
      ownerId,
    },
  })
  const findings: Finding[] = [
    ...report.risks.slice(0, 4).map((t) => ({ title: t, detail: '', kind: 'risk' as const })),
    ...report.openQuestions.slice(0, 3).map((t) => ({ title: t, detail: '', kind: 'assumption' as const })),
    ...report.supportingEvidence.slice(0, 3).map((t) => ({ title: t, detail: '', kind: 'insight' as const })),
  ]
  await persistFindings(tx, reviewRunId, AgentType.Synthesis, findings)
}
