import type {
  CustomerVoiceEvidence,
  CustomerVoiceRecommendation,
  CustomerVoiceTheme,
} from '../../types'
import type { ExtractionResult } from './extract'
import type { DiscussionDoc } from './types'

export interface ScoreResult {
  themes: CustomerVoiceTheme[]
  discussionCount: number
  distinctSubreddits: string[]
  confidence: number
  confidenceLabel: 'Low' | 'Medium' | 'High'
  confidenceReason: string
  recommendation: CustomerVoiceRecommendation
}

const round1 = (n: number): number => Math.round(n * 10) / 10
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

/** Normalize for verbatim substring matching (tolerant of quote chars/whitespace). */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[“”‘’"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Locate a quote in its cited doc; returns whether it's real + the comment score
 * if it came from a comment (anti-hallucination + evidence strength). */
function locate(doc: DiscussionDoc, quote: string): { found: boolean; commentScore: number } {
  const q = norm(quote)
  if (q.length < 8) return { found: false, commentScore: 0 }
  // Require the WHOLE quote to be present verbatim (normalized) — anything we
  // surface as a quote must actually appear in the source. A partial/prefix
  // match is rejected so a paraphrased tail can never be shown as verbatim.
  if (norm(doc.title).includes(q) || norm(doc.body).includes(q)) return { found: true, commentScore: 0 }
  for (const c of doc.comments) {
    if (norm(c.body).includes(q)) return { found: true, commentScore: c.score }
  }
  return { found: false, commentScore: 0 }
}

function severity(mentions: number, emotion: number, engagement: number): number {
  const freq = Math.min(4, 1 + Math.log2(mentions + 1))
  const emo = clamp(emotion, 0, 3)
  const eng = Math.min(3, Math.log10(engagement + 1))
  return clamp(round1(freq + emo + eng), 1, 10)
}

/** Verify quotes, attach real scores, compute per-theme severity + overall confidence. */
export function scoreThemes(extraction: ExtractionResult, docs: DiscussionDoc[]): ScoreResult {
  // Merge by normalized name (safety net against duplicate themes).
  const byName = new Map<string, { name: string; emotion: number; evidence: CustomerVoiceEvidence[] }>()
  const evidencedDocs = new Set<number>()

  for (const theme of extraction.themes) {
    const key = norm(theme.name)
    if (!key) continue
    const entry = byName.get(key) ?? { name: theme.name.trim(), emotion: 0, evidence: [] }
    entry.emotion = Math.max(entry.emotion, clamp(theme.emotionScore ?? 0, 0, 3))
    for (const q of theme.quotes) {
      const doc = docs[q.docIndex]
      if (!doc) continue
      const { found, commentScore } = locate(doc, q.quote)
      if (!found) continue // drop unverifiable quotes — no fabricated evidence
      evidencedDocs.add(q.docIndex)
      entry.evidence.push({
        quote: q.quote.trim(),
        subreddit: doc.subreddit,
        url: doc.url,
        postScore: doc.score,
        commentScore,
      })
    }
    if (entry.evidence.length) byName.set(key, entry)
  }

  const themes: CustomerVoiceTheme[] = [...byName.values()]
    .map((e) => {
      const engagement = e.evidence.reduce((s, ev) => s + ev.postScore + ev.commentScore, 0)
      return {
        name: e.name,
        mentions: e.evidence.length,
        severity: severity(e.evidence.length, e.emotion, engagement),
        evidence: e.evidence.sort((a, b) => b.commentScore + b.postScore - (a.commentScore + a.postScore)),
      }
    })
    .sort((a, b) => b.severity - a.severity || b.mentions - a.mentions)

  const distinctSubreddits = [
    ...new Set(themes.flatMap((t) => t.evidence.map((e) => e.subreddit)).filter(Boolean)),
  ]
  const totalQuotes = themes.reduce((s, t) => s + t.mentions, 0)
  const topMentions = themes.length ? themes[0].mentions : 0

  const volume = Math.min(1, evidencedDocs.size / 20)
  const diversity = Math.min(1, distinctSubreddits.length / 6)
  const quality = Math.min(1, totalQuotes / 12)
  const consistency = totalQuotes ? topMentions / totalQuotes : 0
  const confidence = themes.length
    ? Math.round(100 * (0.35 * volume + 0.25 * diversity + 0.2 * quality + 0.2 * consistency))
    : 0
  const confidenceLabel = confidence >= 75 ? 'High' : confidence >= 50 ? 'Medium' : 'Low'
  const confidenceReason = themes.length
    ? `Evidence across ${distinctSubreddits.length} subreddit${distinctSubreddits.length === 1 ? '' : 's'} and ${evidencedDocs.size} discussion${evidencedDocs.size === 1 ? '' : 's'}.`
    : 'No verifiable customer evidence found.'

  const topSeverity = themes.length ? themes[0].severity : 0
  const recommendation: CustomerVoiceRecommendation =
    confidence >= 75 && topSeverity >= 7
      ? 'Build'
      : confidence >= 50
        ? 'Validate First'
        : confidence >= 30
          ? 'More Research Needed'
          : 'Weak Signal'

  return {
    themes,
    discussionCount: docs.length,
    distinctSubreddits,
    confidence,
    confidenceLabel,
    confidenceReason,
    recommendation,
  }
}
