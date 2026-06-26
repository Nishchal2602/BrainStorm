import type { DetectedSource } from '@/lib/types'
import type {
  AgentResult,
  BuildDecision,
  CompetitorPayload,
  CustomerVoicePayload,
  OrchestrationResult,
} from '@/lib/agents/types'

const KEY = 'pm_run_records'
const MAX_RECORDS = 500

/**
 * Compact, queryable record of one deep-analysis run. The accumulation of these
 * across runs is the seed for a future "Pocket PM Intelligence Graph"
 * (e.g. top missing requirement across N fintech onboarding PRDs).
 */
export interface RunRecord {
  id: string
  timestamp: number
  url?: string
  source: DetectedSource
  industry: string
  productCategory: string
  featureCategory: string
  regulatorySensitivity: string
  decision: { recommendation: BuildDecision; confidence: number }
  risks: string[]
  competitors: string[]
  painPoints: string[]
  missingRequirements: string[]
  recommendations: string[]
}

function findData<T>(results: AgentResult[], agentId: string): T | undefined {
  return results.find((r) => r.agentId === agentId)?.data as T | undefined
}

const clean = (arr: string[] | undefined, cap = 12): string[] =>
  (arr ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, cap)

/** Build a RunRecord from an orchestration result + page metadata. */
export function buildRunRecord(args: {
  id: string
  timestamp: number
  url?: string
  source: DetectedSource
  result: OrchestrationResult
}): RunRecord {
  const { result } = args
  const { analysis } = result
  const competitor = findData<CompetitorPayload>(result.results, 'competitor')
  const voice = findData<CustomerVoicePayload>(result.results, 'customer_voice')

  return {
    id: args.id,
    timestamp: args.timestamp,
    url: args.url,
    source: args.source,
    industry: analysis.industry,
    productCategory: analysis.productCategory,
    featureCategory: analysis.featureCategory,
    regulatorySensitivity: analysis.regulatorySensitivity,
    decision: {
      recommendation: result.report.decision.recommendation,
      confidence: result.report.decision.confidence,
    },
    risks: clean(result.report.risks),
    competitors: clean(competitor?.competitors),
    painPoints: clean(voice?.claims?.map((c) => c.claim)),
    missingRequirements: clean(result.report.missingRequirements),
    recommendations: clean(result.report.decision.rationale),
  }
}

export async function listRunRecords(): Promise<RunRecord[]> {
  const obj = await chrome.storage.local.get(KEY)
  return (obj[KEY] as RunRecord[] | undefined) ?? []
}

export async function addRunRecord(record: RunRecord): Promise<void> {
  const all = await listRunRecords()
  const next = [record, ...all].slice(0, MAX_RECORDS)
  await chrome.storage.local.set({ [KEY]: next })
}

// --- Aggregation (foundation for the future Intelligence Graph; no UI yet) ---

export interface Tally {
  key: string
  count: number
}

function topN(values: string[], n: number): Tally[] {
  const counts = new Map<string, number>()
  for (const v of values) {
    const k = v.trim().toLowerCase()
    if (!k) continue
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
}

export interface Aggregation {
  total: number
  byIndustry: Tally[]
  byFeatureCategory: Tally[]
  byDecision: Tally[]
  topRisks: Tally[]
  topCompetitors: Tally[]
  topPainPoints: Tally[]
  topMissingRequirements: Tally[]
}

/** Pure roll-up over stored records — the query layer a graph/dashboard will use. */
export function aggregate(records: RunRecord[], n = 10): Aggregation {
  return {
    total: records.length,
    byIndustry: topN(records.map((r) => r.industry), n),
    byFeatureCategory: topN(records.map((r) => r.featureCategory), n),
    byDecision: topN(records.map((r) => r.decision.recommendation), n),
    topRisks: topN(records.flatMap((r) => r.risks), n),
    topCompetitors: topN(records.flatMap((r) => r.competitors), n),
    topPainPoints: topN(records.flatMap((r) => r.painPoints), n),
    topMissingRequirements: topN(records.flatMap((r) => r.missingRequirements), n),
  }
}
