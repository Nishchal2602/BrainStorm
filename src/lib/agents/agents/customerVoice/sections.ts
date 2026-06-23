import type { Section } from '@/lib/types'
import type { AgentResult, CustomerVoicePayload } from '../../types'

/**
 * Render Customer Voice evidence as cards so the PM sees real quotes + links,
 * not just the synthesis prose. Reuses Section/Card (sourceUrl + Linkify auto-link
 * URLs in bullets). Returns [] when there's no usable customer-voice result.
 */
export function customerVoiceSections(results: AgentResult[]): Section[] {
  const result = results.find((r) => r.agentId === 'customer_voice')
  // Only render for a successful run — a failed/timed-out retrieval shouldn't
  // show up as a "zero evidence" verdict.
  if (!result || result.status !== 'ok') return []
  const payload = result.data as CustomerVoicePayload | undefined
  if (!payload || !payload.themes) return []

  const sections: Section[] = []
  const subreddits = payload.distinctSubreddits.length
    ? payload.distinctSubreddits.map((s) => `r/${s}`).join(', ')
    : '—'
  const segments = payload.userSegments.length ? payload.userSegments.join(', ') : '—'

  sections.push({
    heading: `Customer Evidence — ${payload.discussionCount} discussion${payload.discussionCount === 1 ? '' : 's'} analyzed`,
    body: `Confidence ${payload.confidence}/100 · Recommendation: ${payload.recommendation} · Breadth: ${subreddits} · Affected users: ${segments}`,
    bullets: payload.themes.length
      ? payload.themes.map(
          (t) => `${t.name} — ${t.mentions} mention${t.mentions === 1 ? '' : 's'}, severity ${t.severity}/10`,
        )
      : ['No recurring themes identified.'],
    tone: 'insight',
    evidenceType: 'Customer Voice',
    confidence: payload.confidenceLabel,
  })

  const topQuotes = payload.themes
    .flatMap((t) => t.evidence)
    .sort((a, b) => b.postScore + b.commentScore - (a.postScore + a.commentScore))
    .slice(0, 3)
  if (topQuotes.length) {
    sections.push({
      heading: 'Strongest customer evidence',
      bullets: topQuotes.map(
        (e) => `"${e.quote}" — r/${e.subreddit} (▲${e.postScore + e.commentScore}) ${e.url}`.trim(),
      ),
      tone: 'insight',
      evidenceType: 'Customer Voice',
    })
  }

  if (payload.confidence < 50) {
    sections.push({
      heading: 'Customer evidence risk',
      body: 'No strong customer evidence supporting this problem.',
      tone: 'risk',
    })
  }

  return sections
}
