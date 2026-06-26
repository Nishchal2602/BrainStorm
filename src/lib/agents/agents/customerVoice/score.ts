import type {
  AffectedUser,
  ClaimEvidence,
  ClaimVerdict,
  CustomerVoiceClaim,
  EvidenceLevel,
} from '../../types'
import type { Claim } from './claims'
import type { Judgment } from './verify'
import type { DiscussionUnit } from './types'

export interface ScoreResult {
  claims: CustomerVoiceClaim[]
  claimsEvaluated: number
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
  claimId: string
  stance: 'supports' | 'contradicts'
  evidence: ClaimEvidence
  docIndex: number
  segment: string
}

/** Verify each judgment's quote verbatim, attach real scores, compute finalScore, filter. */
function scoreJudgments(judgments: Judgment[], units: DiscussionUnit[], claims: Claim[]): Scored[] {
  // Canonical claim ids (case-insensitive) — drop orphan/hallucinated ids so every
  // surviving row maps to a displayed claim card (keeps Claim→quote→URL traceable and
  // stops untraceable rows from inflating evidenceLevel/affectedUsers aggregates).
  const idMap = new Map(claims.map((c) => [c.id.trim().toLowerCase(), c.id]))
  const out: Scored[] = []
  for (const j of judgments) {
    const claimId = idMap.get((j.claimId || '').trim().toLowerCase())
    if (!claimId) continue // judgment references no real claim → discard
    const unit = units[j.unitIndex]
    if (!unit) continue
    if (j.stance !== 'supports' && j.stance !== 'contradicts') continue // unrelated already dropped upstream
    const q = norm(j.quote)
    if (q.length < 8 || !norm(unit.text).includes(q)) continue // verbatim guard — drop fabrications

    const relevanceScore = clamp10(j.relevanceScore)
    const evidenceStrength = clamp10(j.evidenceStrength)
    const authorCredibility = clamp10(j.authorCredibility)
    const engagementScore = engagementOf(unit.score)
    const finalScore = round1(
      0.45 * relevanceScore + 0.25 * evidenceStrength + 0.15 * engagementScore + 0.15 * authorCredibility,
    )
    // Quality filter — precision over coverage.
    if (relevanceScore < 7 || finalScore < 6) continue

    out.push({
      claimId,
      stance: j.stance,
      docIndex: unit.docIndex,
      segment: (j.segment || '').trim(),
      evidence: {
        quote: j.quote.trim(),
        subreddit: unit.subreddit,
        url: unit.url,
        postScore: unit.unitId === 'post' ? unit.score : 0,
        commentScore: unit.unitId === 'post' ? 0 : unit.score,
        relevanceScore,
        evidenceStrength,
        engagementScore,
        authorCredibility,
        finalScore,
      },
    })
  }
  return out
}

function verdictOf(
  s: number,
  c: number,
  avgFinal: number,
  topFinal: number,
  distinctThreads: number,
): ClaimVerdict {
  if (s === 0) return 'Unsupported'
  if (s >= 3 && avgFinal >= 8 && c <= 1 && distinctThreads >= 3) return 'Strongly Supported'
  if (s >= 2 && topFinal >= 7 && s > c && distinctThreads >= 2) return 'Supported'
  if (s >= 1 && c >= 1 && Math.abs(s - c) <= 1) return 'Mixed Evidence'
  if (s === 1 || distinctThreads === 1) return 'Weak Evidence'
  return 'Supported'
}

const mean = (ns: number[]): number => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0)

/** Steps 4–6: group by claim, verbatim-filter, score verdicts (diversity-weighted), evidenceLevel. */
export function scoreClaims(
  claims: Claim[],
  judgments: Judgment[],
  units: DiscussionUnit[],
  discussionCount: number,
): ScoreResult {
  const scored = scoreJudgments(judgments, units, claims)

  const claimResults: CustomerVoiceClaim[] = claims.map((claim) => {
    const mine = scored.filter((x) => x.claimId === claim.id)
    const supporting = mine.filter((x) => x.stance === 'supports').map((x) => x.evidence)
    const contradicting = mine.filter((x) => x.stance === 'contradicts').map((x) => x.evidence)
    supporting.sort((a, b) => b.finalScore - a.finalScore)
    contradicting.sort((a, b) => b.finalScore - a.finalScore)

    const s = supporting.length
    const c = contradicting.length
    const supThreads = new Set(mine.filter((x) => x.stance === 'supports').map((x) => x.docIndex))
    const distinctThreads = supThreads.size
    const distinctSubs = new Set(supporting.map((e) => e.subreddit)).size
    const avgFinal = mean(supporting.map((e) => e.finalScore))
    const topFinal = supporting[0]?.finalScore ?? 0

    const verdict = verdictOf(s, c, avgFinal, topFinal, distinctThreads)
    const breadthMultiplier = 0.4 + 0.6 * Math.min(1, distinctThreads / 4)
    const base = 0.5 * (Math.min(s, 4) / 4) + 0.5 * (avgFinal / 10) - Math.min(0.3, 0.15 * c)
    const confidence = s === 0 ? 0 : Math.round(100 * clamp(base, 0, 1) * breadthMultiplier)

    return {
      id: claim.id,
      claim: claim.claim,
      verdict,
      confidence,
      supportingCount: s,
      contradictingCount: c,
      sourceBreadth: { distinctThreads, distinctSubreddits: distinctSubs },
      supporting,
      contradicting,
    }
  })

  // affectedUsers: aggregate author segments across all surviving evidence.
  const segCounts = new Map<string, number>()
  for (const x of scored) {
    const seg = x.segment
    if (!seg) continue
    const key = seg.toLowerCase()
    segCounts.set(key, (segCounts.get(key) ?? 0) + 1)
  }
  const labelBySeg = new Map<string, string>()
  for (const x of scored) if (x.segment) labelBySeg.set(x.segment.toLowerCase(), x.segment)
  const affectedUsers: AffectedUser[] = [...segCounts.entries()]
    .map(([k, mentions]) => ({ segment: labelBySeg.get(k) ?? k, mentions }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 8)

  const distinctSubreddits = [
    ...new Set(scored.map((x) => x.evidence.subreddit).filter(Boolean)),
  ]
  const totalSupporting = scored.filter((x) => x.stance === 'supports').length
  const supportedClaims = claimResults.filter(
    (c) => c.verdict === 'Strongly Supported' || c.verdict === 'Supported',
  ).length
  const claimsWithSupport = claimResults.filter((c) => c.supportingCount > 0).length

  const evidenceLevel: EvidenceLevel =
    supportedClaims >= 1 || claimsWithSupport >= 2
      ? 'Strong evidence found'
      : totalSupporting > 0
        ? 'Limited evidence found'
        : 'No evidence found'

  // Overall confidence = mean of evaluated claims' confidence.
  const overallConfidence = claimResults.length
    ? Math.round(mean(claimResults.map((c) => c.confidence)))
    : 0
  const overallConfidenceLabel =
    overallConfidence >= 75 ? 'High' : overallConfidence >= 50 ? 'Medium' : 'Low'

  return {
    claims: claimResults,
    claimsEvaluated: claimResults.length,
    discussionCount,
    distinctSubreddits,
    overallConfidence,
    overallConfidenceLabel,
    evidenceLevel,
    affectedUsers,
  }
}
