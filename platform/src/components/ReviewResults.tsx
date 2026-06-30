import { prisma } from '@/lib/db'
import {
  ReviewDashboard,
  type ReviewData,
  type Kpi,
  type EvidenceItem,
  type CompetitorItem,
  type ExecStep,
  type Quote,
} from './ReviewDashboard'

const asArray = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(String) : [])
const asQuotes = (v: unknown): Quote[] => (Array.isArray(v) ? (v as Quote[]) : [])

/** Capabilities are persisted as evidence objects ({ name, url, quote }); surface their names. */
function asNames(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return (v as unknown[])
    .map((x) => {
      if (typeof x === 'string') return x
      if (x && typeof x === 'object' && typeof (x as Record<string, unknown>).name === 'string')
        return (x as Record<string, string>).name
      return ''
    })
    .filter(Boolean)
}

/** Normalize the open-ended `sources` JSON into display rows. */
function asSources(v: unknown): { label: string; url?: string }[] {
  if (!Array.isArray(v)) return []
  return (v as unknown[])
    .map((s) => {
      if (typeof s === 'string') return { label: s }
      if (s && typeof s === 'object') {
        const o = s as Record<string, unknown>
        const url = typeof o.url === 'string' ? o.url : typeof o.permalink === 'string' ? o.permalink : undefined
        const label =
          (typeof o.title === 'string' && o.title) ||
          (typeof o.subreddit === 'string' && `r/${o.subreddit}`) ||
          (url ? new URL(url).hostname.replace(/^www\./, '') : 'source')
        return { label: String(label), url }
      }
      return null
    })
    .filter((s): s is { label: string; url?: string } => s != null)
}

type Tone = 'emerald' | 'amber' | 'rose' | 'slate' | 'violet'

const RECO: Record<string, { label: string; tone: Tone }> = {
  Build: { label: 'Build', tone: 'emerald' },
  BuildWithChanges: { label: 'Build with Changes', tone: 'emerald' },
  ValidateFirst: { label: 'Validate First', tone: 'amber' },
  DoNotBuild: { label: "Don't Build", tone: 'rose' },
}
const VERDICT: Record<string, { label: string; tone: Tone }> = {
  Supported: { label: 'Supported', tone: 'emerald' },
  Mixed: { label: 'Mixed', tone: 'amber' },
  Weak: { label: 'Weak', tone: 'slate' },
  Contradicted: { label: 'Contradicted', tone: 'rose' },
  NoEvidence: { label: 'No Evidence', tone: 'slate' },
}

const STEPS: [string, string][] = [
  ['sharedAnalysis', 'Document Analysis'],
  ['pmReview', 'PM Review'],
  ['customerVoice', 'Customer Voice'],
  ['competitor', 'Competitor Intelligence'],
  ['recommendation', 'Recommendation'],
]

function durationLabel(start: Date | null, end: Date | null): string | null {
  if (!start || !end) return null
  const ms = end.getTime() - start.getTime()
  if (ms <= 0) return null
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

/** Server component: fetches the persisted review outputs (queries unchanged) and
 *  hands a fully-serialized, presentation-ready view to the dashboard. */
export async function ReviewResults({ runId }: { runId: string }) {
  const [run, pmReview, evidence, snapshots, decision] = await Promise.all([
    prisma.reviewRun.findUnique({ where: { id: runId } }),
    prisma.pMReview.findUnique({ where: { reviewRunId: runId } }),
    prisma.customerEvidence.findMany({ where: { reviewRunId: runId } }),
    prisma.competitorSnapshot.findMany({ where: { reviewRunId: runId }, include: { competitor: true } }),
    prisma.decision.findFirst({ where: { reviewRunId: runId }, orderBy: { createdAt: 'desc' } }),
  ])
  if (!run) return null

  // ---- PM Review groups (full lists preserved) ----
  const risks = asArray(pmReview?.risks)
  const missingRequirements = asArray(pmReview?.missingRequirements)
  const openQuestions = asArray(pmReview?.openQuestions)
  const rolloutRisks = asArray(pmReview?.rolloutRisks)
  const suggestedExperiments = asArray(pmReview?.suggestedExperiments)
  const pmGroups = [
    { label: 'Risks', items: risks },
    { label: 'Missing Requirements', items: missingRequirements },
    { label: 'Open Questions', items: openQuestions },
    { label: 'Rollout Risks', items: rolloutRisks },
    { label: 'Suggested Experiments', items: suggestedExperiments },
  ].filter((g) => g.items.length > 0)

  // ---- Customer Evidence ----
  const evidenceItems: EvidenceItem[] = evidence.map((e) => {
    const v = VERDICT[e.verdict] ?? { label: e.verdict, tone: 'slate' as Tone }
    return {
      id: e.id,
      claim: e.claim,
      verdict: e.verdict,
      verdictLabel: v.label,
      verdictTone: v.tone,
      supportingCount: e.supportingCount,
      contradictingCount: e.contradictingCount,
      quotes: asQuotes(e.supportingQuotes),
      sources: asSources(e.sources),
    }
  })

  // ---- Competitors ----
  const competitors: CompetitorItem[] = snapshots.map((s) => ({
    id: s.id,
    name: s.competitor.name,
    category: s.competitor.category,
    positioning: s.competitor.positioning,
    strengths: asArray(s.strengths),
    weaknesses: asArray(s.weaknesses),
    capabilities: asNames(s.capabilities),
    threatLevel: s.threatLevel,
    differentiationScore: s.differentiationScore != null ? Number(s.differentiationScore) : null,
  }))

  // ---- KPI derivations (presentation-only — no new queries / AI) ----
  const evCount = evidence.length
  const supportedN = evidence.filter((e) => e.verdict === 'Supported').length
  const contradictedN = evidence.filter((e) => e.verdict === 'Contradicted').length
  let demand: { value: string; tone: Tone } = { value: 'No Evidence', tone: 'slate' }
  if (evCount > 0) {
    if (supportedN > 0 && supportedN >= contradictedN && supportedN / evCount >= 0.4)
      demand = { value: 'Supported', tone: 'emerald' }
    else if (supportedN > 0) demand = { value: 'Mixed', tone: 'amber' }
    else if (contradictedN > 0) demand = { value: 'Contradicted', tone: 'rose' }
    else demand = { value: 'Weak', tone: 'slate' }
  }

  const compCount = snapshots.length
  const threatRank: Record<string, number> = { Low: 1, Medium: 2, High: 3 }
  const maxThreat = snapshots.reduce(
    (m, s) => (s.threatLevel && threatRank[s.threatLevel] > m ? threatRank[s.threatLevel] : m),
    0,
  )
  let competition: { value: string; tone: Tone } = { value: 'None', tone: 'slate' }
  if (compCount > 0) {
    const lvl = maxThreat || (compCount >= 8 ? 3 : compCount >= 4 ? 2 : 1)
    competition = {
      value: lvl === 3 ? 'High' : lvl === 2 ? 'Medium' : 'Low',
      tone: lvl === 3 ? 'rose' : lvl === 2 ? 'amber' : 'emerald',
    }
  }

  const riskSignals = risks.length + rolloutRisks.length + missingRequirements.length
  let execRisk: { value: string; tone: Tone } = { value: 'Low', tone: 'emerald' }
  if (riskSignals >= 8) execRisk = { value: 'High', tone: 'rose' }
  else if (riskSignals >= 4) execRisk = { value: 'Medium', tone: 'amber' }

  const reco = run.recommendation ? RECO[run.recommendation] ?? { label: run.recommendation, tone: 'slate' as Tone } : null
  const confidencePct = run.confidence != null ? Math.round(Number(run.confidence) * 100) : null

  const kpis: Kpi[] = [
    { label: 'Customer Demand', value: demand.value, sub: `${evCount} insight${evCount === 1 ? '' : 's'}`, tone: demand.tone },
    {
      label: 'Competition',
      value: competition.value,
      sub: `${compCount} competitor${compCount === 1 ? '' : 's'}`,
      tone: competition.tone,
    },
    {
      label: 'Execution Risk',
      value: execRisk.value,
      sub: `${missingRequirements.length} missing requirement${missingRequirements.length === 1 ? '' : 's'}`,
      tone: execRisk.tone,
    },
    {
      label: 'Recommendation',
      value: reco?.label ?? 'Pending',
      sub: confidencePct != null ? `${confidencePct}% confidence` : '—',
      tone: reco?.tone ?? 'slate',
    },
  ]

  // ---- Hero highlights (top opportunity = strongest supported claim; biggest risk = top risk) ----
  const topSupported = [...evidence]
    .filter((e) => e.verdict === 'Supported')
    .sort((a, b) => b.supportingCount - a.supportingCount)[0]
  const topOpportunity = topSupported?.claim ?? suggestedExperiments[0] ?? null
  const biggestRisk = risks[0] ?? rolloutRisks[0] ?? missingRequirements[0] ?? null

  // ---- Execution timeline ----
  const ag = (run.agentStatus as Record<string, string> | null) ?? {}
  const isLemma = ag.__engine === 'lemma'
  const steps: ExecStep[] = STEPS.map(([key, label]) => {
    const raw = ag[key] ?? (run.status === 'Completed' ? 'completed' : 'pending')
    const state = (['pending', 'running', 'completed', 'failed'].includes(raw) ? raw : 'pending') as ExecStep['state']
    return { key, label, state }
  })

  const data: ReviewData = {
    recommendation: reco,
    confidencePct,
    executiveSummary: decision?.decision ?? pmReview?.summary ?? null,
    topOpportunity,
    biggestRisk,
    rationale: decision?.rationale ?? null,
    kpis,
    execution: {
      isLemma,
      lemmaRunId: isLemma ? ag.__lemmaRunId ?? null : null,
      status: run.status,
      startedAt: run.startedAt ? run.startedAt.toISOString() : null,
      completedAt: run.completedAt ? run.completedAt.toISOString() : null,
      durationLabel: durationLabel(run.startedAt, run.completedAt),
      steps,
    },
    pmReview: pmReview ? { summary: pmReview.summary, groups: pmGroups } : null,
    evidence: evidenceItems,
    competitors,
  }

  return <ReviewDashboard data={data} />
}
