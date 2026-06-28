import type { Confidence, Section, SectionTone } from '@/lib/types'
import type {
  AgentResult,
  CustomerVoiceHypothesis,
  CustomerVoicePayload,
  HypothesisEvidence,
  HypothesisVerdict,
} from '../../types'

const quoteLine = (e: HypothesisEvidence): string =>
  `"${e.quote}" — r/${e.subreddit} (▲${e.postScore + e.commentScore}) ${e.url}`.trim()

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

interface VerdictMeta {
  label: string
  tone: SectionTone
}
const VERDICT: Record<HypothesisVerdict, VerdictMeta> = {
  supported: { label: '✅ Supported', tone: 'insight' },
  mixed: { label: '⚠️ Mixed evidence', tone: 'unknown' },
  contradicted: { label: '⛔ Contradicted', tone: 'risk' },
  insufficient_evidence: { label: '❌ No evidence found', tone: 'unknown' },
}

const confBand = (n: number): Confidence => (n >= 75 ? 'High' : n >= 50 ? 'Medium' : 'Low')

/** Render one research-paper card per hypothesis: verdict + confidence + evidence
 * quality + diversity + the verbatim Top Quotes / Counter Evidence behind it
 * (Hypothesis→quote→URL traceability). Reuses Section/Card; returns [] for a
 * non-ok/absent result. */
export function customerVoiceSections(results: AgentResult[]): Section[] {
  const result = results.find((r) => r.agentId === 'customer_voice')
  if (!result || result.status !== 'ok') return []
  const p = result.data as CustomerVoicePayload | undefined
  if (!p || !p.hypotheses) return []

  const sections: Section[] = []

  // Lead card — the validation summary (never "demand doesn't exist").
  sections.push({
    heading: `Customer Validation — ${plural(p.hypothesesEvaluated, 'hypothesis')}`,
    body:
      `✅ ${p.supportedCount} Supported · ⚠️ ${p.mixedCount} Mixed · ` +
      `⛔ ${p.contradictedCount} Contradicted · ❌ ${p.insufficientCount} No evidence\n` +
      `${p.evidenceLevel} · Overall confidence ${p.overallConfidence}% · ${plural(p.discussionCount, 'discussion')} analyzed`,
    tone: 'insight',
    evidenceType: 'Customer Voice',
    confidence: p.overallConfidenceLabel,
  })

  // One scannable card per hypothesis (the card border is the divider).
  p.hypotheses.forEach((h, i) => sections.push(hypothesisCard(h, i + 1)))

  if (p.affectedUsers.length) {
    sections.push({
      heading: 'Affected users',
      bullets: p.affectedUsers.map((u) => `${u.segment} (${u.mentions})`),
      tone: 'default',
      evidenceType: 'Customer Voice',
    })
  }

  return sections
}

function hypothesisCard(h: CustomerVoiceHypothesis, n: number): Section {
  const meta = VERDICT[h.verdict]
  const quoteCount = h.supporting.length + h.contradicting.length

  if (h.verdict === 'insufficient_evidence') {
    return {
      heading: `Claim ${n} · ${meta.label}`,
      body:
        `${h.statement}\n` +
        'Insufficient public evidence — this reflects discussion availability, not absence of demand. Validate directly with target users.',
      tone: meta.tone,
      evidenceType: 'Customer Voice',
    }
  }

  const b = h.sourceBreadth
  const bullets = h.supporting.slice(0, 3).map(quoteLine)
  if (h.contradicting.length) {
    bullets.push('— Counter evidence —', ...h.contradicting.slice(0, 2).map(quoteLine))
  }

  return {
    heading: `Claim ${n} · ${meta.label}`,
    body:
      `${h.statement}\n` +
      `Confidence ${h.confidence}% · Evidence quality: ${h.evidenceQuality} · ` +
      `${plural(b.distinctThreads, 'thread')} · ${plural(quoteCount, 'quote')} · ` +
      `${plural(b.distinctSubreddits, 'subreddit')} · ${plural(b.distinctAuthors, 'author')}`,
    bullets,
    tone: meta.tone,
    evidenceType: 'Customer Voice',
    confidence: confBand(h.confidence),
  }
}
