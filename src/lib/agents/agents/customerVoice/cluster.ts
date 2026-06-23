import type { SourceRef } from '@/lib/types'
import type {
  CustomerVoicePayload,
  Evidence,
  Finding,
  RecurringPainPoint,
  Sentiment,
} from '../../types'
import type { ParsedCluster, ParsedCustomerVoice, ParsedDiscussion } from './parse'

const MAX_EVIDENCE = 24
const MAX_SEGMENTS = 8
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** A pain point seen more often, with consistent negativity, is more trustworthy. */
function painPointConfidence(frequency: number, sentiment: Sentiment): number {
  const volume = Math.min(1, frequency / 5) // 5+ corroborating discussions ⇒ full volume signal
  const consistency = sentiment === 'neutral' ? 0.7 : 1 // a clear sentiment is a stronger signal
  return clamp01(0.3 + 0.6 * volume * consistency)
}

const SENT_RANK: Record<Sentiment, number> = { negative: 2, neutral: 1, positive: 0 }

/** Merge clusters whose titles normalize equal; combine discussions; vote sentiment by volume. */
function mergeClusters(clusters: ParsedCluster[]): ParsedCluster[] {
  const byKey = new Map<string, ParsedCluster>()
  const votes = new Map<string, Record<Sentiment, number>>()
  for (const c of clusters) {
    const key = normalizeTitle(c.title)
    if (!key) continue
    const existing = byKey.get(key)
    if (existing) {
      existing.discussions.push(...c.discussions)
    } else {
      byKey.set(key, { title: c.title, sentiment: c.sentiment, discussions: [...c.discussions] })
      votes.set(key, { negative: 0, neutral: 0, positive: 0 })
    }
    const v = votes.get(key)!
    v[c.sentiment] += Math.max(1, c.discussions.length)
  }
  for (const [key, c] of byKey) {
    const v = votes.get(key)!
    c.sentiment = (['negative', 'neutral', 'positive'] as Sentiment[]).reduce((best, s) =>
      v[s] > v[best] || (v[s] === v[best] && SENT_RANK[s] > SENT_RANK[best]) ? s : best,
    )
  }
  return [...byKey.values()]
}

function discussionToEvidence(d: ParsedDiscussion): Evidence {
  return {
    sourceType: d.source,
    title: d.title || undefined,
    snippet: d.snippet || undefined,
    url: d.url,
    discoveredQuery: d.query,
  }
}

export interface ClusterOutput {
  payload: CustomerVoicePayload
  findings: Finding[]
  confidence: number
  discussionCount: number
}

/** Pure transform: parsed retrieval → CustomerVoicePayload + Findings + overall confidence. */
export function toPayloadAndFindings(
  parsed: ParsedCustomerVoice,
  groundingSources: SourceRef[] = [],
): ClusterOutput {
  const merged = mergeClusters(parsed.clusters)
  const discussionCount = merged.reduce((n, c) => n + c.discussions.length, 0)

  const painPoints: RecurringPainPoint[] = merged
    .map((c) => ({
      title: c.title,
      frequency: c.discussions.length,
      sentiment: c.sentiment,
      confidence: painPointConfidence(c.discussions.length, c.sentiment),
    }))
    .sort((a, b) => b.frequency - a.frequency || b.confidence - a.confidence)

  // Evidence: per-discussion first, then any grounding sources not already covered.
  const evidence: Evidence[] = []
  const seenUrls = new Set<string>()
  for (const c of merged) {
    for (const d of c.discussions) {
      const ev = discussionToEvidence(d)
      const key = ev.url ?? `${ev.title}|${ev.snippet}`
      if (seenUrls.has(key)) continue
      seenUrls.add(key)
      evidence.push(ev)
    }
  }
  for (const s of groundingSources) {
    if (!s.url || seenUrls.has(s.url)) continue
    seenUrls.add(s.url)
    evidence.push({ sourceType: 'web', title: s.title, url: s.url })
  }

  const findings: Finding[] = merged.map((c) => {
    const freq = c.discussions.length
    return {
      title: c.title,
      detail: `Mentioned in ${freq} discussion${freq === 1 ? '' : 's'} (${c.sentiment}).`,
      kind: 'support',
      severity: c.sentiment === 'negative' && freq >= 3 ? 'high' : 'medium',
      confidence: painPointConfidence(freq, c.sentiment),
      evidence: c.discussions.map(discussionToEvidence),
    }
  })

  // Overall confidence: scales with total corroborating volume; 0 when nothing found.
  const confidence = merged.length ? clamp01(0.2 + 0.8 * Math.min(1, discussionCount / 8)) : 0

  const sentimentSummary =
    parsed.sentimentSummary ||
    (merged.length
      ? `${discussionCount} discussions across ${merged.length} recurring themes.`
      : 'No relevant public discussions found.')

  const payload: CustomerVoicePayload = {
    recurringPainPoints: painPoints,
    userSegments: dedupCap(parsed.segments, MAX_SEGMENTS),
    sentimentSummary,
    supportingEvidence: evidence.slice(0, MAX_EVIDENCE),
  }

  return { payload, findings, confidence, discussionCount }
}

function dedupCap(items: string[], cap: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of items) {
    const s = raw.trim()
    if (!s) continue
    const k = s.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
    if (out.length >= cap) break
  }
  return out
}
