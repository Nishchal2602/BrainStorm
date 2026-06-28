import type {
  AffectedUser,
  CustomerVoiceHypothesis,
  EvidenceLevel,
  HypothesisEvidence,
  HypothesisVerdict,
} from '../../types'
import type { Hypothesis } from './hypothesis'
import type { Judgment } from './verify'
import type { DiscussionUnit } from './types'

export interface ScoreResult {
  hypotheses: CustomerVoiceHypothesis[]
  hypothesesEvaluated: number
  supportedCount: number
  mixedCount: number
  insufficientCount: number
  contradictedCount: number
  discussionCount: number
  distinctSubreddits: string[]
  overallConfidence: number
  overallConfidenceLabel: 'Low' | 'Medium' | 'High'
  evidenceLevel: EvidenceLevel
  affectedUsers: AffectedUser[]
}

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : 0))
const clamp10 = (n: number): number => clamp(n, 0, 10)
const round1 = (n: number): number => Math.round(n * 10) / 10
const mean = (ns: number[]): number => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0)

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[“”‘’"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** engagementScore 0-10 from the unit's own upvotes. */
function engagementOf(unitScore: number): number {
  return round1(clamp10(10 * Math.min(1, Math.log10(Math.max(0, unitScore) + 1) / 3)))
}

interface Scored {
  hypothesisId: string
  stance: 'supports' | 'contradicts'
  evidence: HypothesisEvidence
  docIndex: number
  segment: string
}

/** Verify each judgment's quote verbatim, attach real scores, compute finalScore, filter. */
function scoreJudgments(
  judgments: Judgment[],
  units: DiscussionUnit[],
  hypotheses: Hypothesis[],
): Scored[] {
  // Canonical hypothesis ids (case-insensitive) — drop orphan/hallucinated ids so every
  // surviving row maps to a displayed hypothesis (keeps Hypothesis→quote→URL traceable
  // and stops untraceable rows from inflating evidenceLevel/affectedUsers aggregates).
  const idMap = new Map(hypotheses.map((h) => [h.id.trim().toLowerCase(), h.id]))
  const out: Scored[] = []
  for (const j of judgments) {
    const hypothesisId = idMap.get((j.hypothesisId || '').trim().toLowerCase())
    if (!hypothesisId) continue // judgment references no real hypothesis → discard
    const unit = units[j.unitIndex]
    if (!unit) continue
    if (j.stance !== 'supports' && j.stance !== 'contradicts') continue // unrelated already dropped upstream
    const q = norm(j.quote)
    if (q.length < 8 || !norm(unit.text).includes(q)) continue // verbatim guard — drop fabrications

    const problemMatch = clamp10(j.problemMatch)
    const personaMatch = clamp10(j.personaMatch)
    const productMatch = clamp10(j.productMatch)
    const evidenceStrength = clamp10(j.evidenceStrength)
    const authorCredibility = clamp10(j.authorCredibility)
    const engagementScore = engagementOf(unit.score)
    const finalScore = round1(
      0.35 * problemMatch +
        0.15 * personaMatch +
        0.15 * productMatch +
        0.15 * evidenceStrength +
        0.1 * engagementScore +
        0.1 * authorCredibility,
    )
    // Quality filter — precision over coverage. Problem match is the hard gate.
    if (problemMatch < 7 || finalScore < 6) continue

    out.push({
      hypothesisId,
      stance: j.stance,
      docIndex: unit.docIndex,
      segment: (j.segment || '').trim(),
      evidence: {
        quote: j.quote.trim(),
        subreddit: unit.subreddit,
        url: unit.url,
        author: unit.author,
        postScore: unit.unitId === 'post' ? unit.score : 0,
        commentScore: unit.unitId === 'post' ? 0 : unit.score,
        problemMatch,
        personaMatch,
        productMatch,
        evidenceStrength,
        engagementScore,
        authorCredibility,
        finalScore,
      },
    })
  }
  return out
}

function verdictOf(s: number, c: number, distinctThreads: number): HypothesisVerdict {
  if (s === 0 && c === 0) return 'insufficient_evidence'
  if (c > s && (c >= 2 || s === 0)) return 'contradicted'
  if (s >= 1 && c >= 1 && Math.abs(s - c) <= 1) return 'mixed'
  if (s >= 2 && s > c && distinctThreads >= 2) return 'supported'
  return 'insufficient_evidence' // support too thin (single quote / single thread)
}

const relevanceOf = (e: HypothesisEvidence): number =>
  (e.problemMatch + e.personaMatch + e.productMatch) / 3

function qualityBand(avgFinal: number): 'High' | 'Medium' | 'Low' {
  return avgFinal >= 8 ? 'High' : avgFinal >= 6 ? 'Medium' : 'Low'
}

/** Diversity 0..1 from distinct threads + authors + subreddits (true multiplier:
 * many quotes from one thread can't reach a high score). */
function diversityOf(ev: HypothesisEvidence[], docIndexById: Map<HypothesisEvidence, number>): number {
  const threads = new Set(ev.map((e) => docIndexById.get(e)))
  const authors = new Set(ev.map((e) => (e.author || '').toLowerCase()).filter(Boolean))
  const subs = new Set(ev.map((e) => e.subreddit.toLowerCase()).filter(Boolean))
  return Math.min(
    1,
    (Math.min(1, threads.size / 5) + Math.min(1, authors.size / 8) + Math.min(1, subs.size / 4)) / 3,
  )
}

/** Steps 5–6: group by hypothesis, verdict, product-form confidence, evidenceLevel. */
export function scoreHypotheses(
  hypotheses: Hypothesis[],
  judgments: Judgment[],
  units: DiscussionUnit[],
  discussionCount: number,
): ScoreResult {
  const scored = scoreJudgments(judgments, units, hypotheses)
  // Map evidence → its thread index (for diversity), preserved per Scored row.
  const docIndexById = new Map<HypothesisEvidence, number>()
  for (const x of scored) docIndexById.set(x.evidence, x.docIndex)

  const results: CustomerVoiceHypothesis[] = hypotheses.map((h) => {
    const mine = scored.filter((x) => x.hypothesisId === h.id)
    const supporting = mine.filter((x) => x.stance === 'supports').map((x) => x.evidence)
    const contradicting = mine.filter((x) => x.stance === 'contradicts').map((x) => x.evidence)
    supporting.sort((a, b) => b.finalScore - a.finalScore)
    contradicting.sort((a, b) => b.finalScore - a.finalScore)

    const s = supporting.length
    const c = contradicting.length
    const supThreads = new Set(
      mine.filter((x) => x.stance === 'supports').map((x) => x.docIndex),
    )
    const distinctThreads = supThreads.size
    const verdict = verdictOf(s, c, distinctThreads)

    // Confidence + breadth + quality are computed over the side that drives the verdict.
    const dom = verdict === 'contradicted' ? contradicting : supporting
    const avgFinal = mean(dom.map((e) => e.finalScore))
    const quality = avgFinal / 10
    const relevance = mean(dom.map(relevanceOf)) / 10
    const agreement = s + c > 0 ? Math.max(s, c) / (s + c) : 0
    const diversity = diversityOf(dom, docIndexById)
    const confidence = dom.length
      ? Math.round(100 * clamp(quality * diversity * agreement * relevance, 0, 1))
      : 0

    return {
      id: h.id,
      statement: h.statement,
      category: h.category,
      verdict,
      confidence,
      evidenceQuality: qualityBand(avgFinal),
      supportingCount: s,
      contradictingCount: c,
      sourceBreadth: {
        distinctThreads: new Set(dom.map((e) => docIndexById.get(e))).size,
        distinctSubreddits: new Set(dom.map((e) => e.subreddit.toLowerCase()).filter(Boolean)).size,
        distinctAuthors: new Set(dom.map((e) => (e.author || '').toLowerCase()).filter(Boolean)).size,
      },
      supporting,
      contradicting,
    }
  })

  // affectedUsers: aggregate author segments across all surviving evidence.
  const segCounts = new Map<string, number>()
  const labelBySeg = new Map<string, string>()
  for (const x of scored) {
    const seg = x.segment
    if (!seg) continue
    const key = seg.toLowerCase()
    segCounts.set(key, (segCounts.get(key) ?? 0) + 1)
    labelBySeg.set(key, seg)
  }
  const affectedUsers: AffectedUser[] = [...segCounts.entries()]
    .map(([k, mentions]) => ({ segment: labelBySeg.get(k) ?? k, mentions }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 8)

  const distinctSubreddits = [...new Set(scored.map((x) => x.evidence.subreddit).filter(Boolean))]

  const supportedCount = results.filter((h) => h.verdict === 'supported').length
  const mixedCount = results.filter((h) => h.verdict === 'mixed').length
  const contradictedCount = results.filter((h) => h.verdict === 'contradicted').length
  const insufficientCount = results.filter((h) => h.verdict === 'insufficient_evidence').length
  const withSupport = results.filter((h) => h.supportingCount > 0).length

  const evidenceLevel: EvidenceLevel =
    supportedCount >= 1 || withSupport >= 2
      ? 'Strong evidence found'
      : withSupport > 0
        ? 'Limited evidence found'
        : 'Insufficient public evidence'

  // Overall confidence = mean of evaluated hypotheses' confidence.
  const overallConfidence = results.length
    ? Math.round(mean(results.map((h) => h.confidence)))
    : 0
  const overallConfidenceLabel =
    overallConfidence >= 75 ? 'High' : overallConfidence >= 50 ? 'Medium' : 'Low'

  return {
    hypotheses: results,
    hypothesesEvaluated: results.length,
    supportedCount,
    mixedCount,
    insufficientCount,
    contradictedCount,
    discussionCount,
    distinctSubreddits,
    overallConfidence,
    overallConfidenceLabel,
    evidenceLevel,
    affectedUsers,
  }
}
