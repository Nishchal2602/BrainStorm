import type { Section } from '@/lib/types'
import type {
  AgentResult,
  ClaimEvidence,
  CustomerVoiceClaim,
  CustomerVoicePayload,
} from '../../types'

const quoteLine = (e: ClaimEvidence): string =>
  `"${e.quote}" — r/${e.subreddit} (▲${e.postScore + e.commentScore}) ${e.url}`.trim()

/** PM-facing verdict label. Keeps the bare word "Unsupported" — which reads as
 * "the claim is false / no demand" — out of the UI. Absence of supporting evidence
 * is framed as evidence absence, never demand absence. */
function verdictLabel(c: CustomerVoiceClaim): string {
  if (c.verdict !== 'Unsupported') return c.verdict
  return c.contradictingCount > 0 ? 'Evidence contradicts this claim' : 'No evidence found'
}

/**
 * Render claim-validation evidence as cards so the PM sees verdicts + real quotes
 * + links (Claim→quote→URL traceability). Reuses Section/Card (Linkify auto-links
 * URLs in bullets). Returns [] for a non-ok/absent result.
 */
export function customerVoiceSections(results: AgentResult[]): Section[] {
  const result = results.find((r) => r.agentId === 'customer_voice')
  if (!result || result.status !== 'ok') return []
  const p = result.data as CustomerVoicePayload | undefined
  if (!p || !p.claims) return []

  const sections: Section[] = []
  const subreddits = p.distinctSubreddits.length
    ? p.distinctSubreddits.map((s) => `r/${s}`).join(', ')
    : '—'

  // Header: claims evaluated + evidence level (never "demand doesn't exist").
  sections.push({
    heading: `Customer Evidence — ${p.claimsEvaluated} claim${p.claimsEvaluated === 1 ? '' : 's'} evaluated`,
    body: `${p.evidenceLevel} · Overall confidence ${p.overallConfidence}/100 · ${p.discussionCount} discussion${p.discussionCount === 1 ? '' : 's'} · Breadth: ${subreddits}`,
    bullets: p.claims.length
      ? p.claims.map(
          (c) =>
            `${c.claim} — ${verdictLabel(c)} (${c.confidence}% · ${c.supportingCount} supporting / ${c.contradictingCount} contradicting across ${c.sourceBreadth.distinctThreads} thread${c.sourceBreadth.distinctThreads === 1 ? '' : 's'})`,
        )
      : ['No claims could be evaluated from public discussion.'],
    tone: 'insight',
    evidenceType: 'Customer Voice',
    confidence: p.overallConfidenceLabel,
  })

  const supporting = p.claims.flatMap((c) => c.supporting).sort((a, b) => b.finalScore - a.finalScore)
  if (supporting.length) {
    sections.push({
      heading: 'Strongest supporting evidence',
      bullets: supporting.slice(0, 3).map(quoteLine),
      tone: 'insight',
      evidenceType: 'Customer Voice',
    })
  }

  const contradicting = p.claims
    .flatMap((c) => c.contradicting)
    .sort((a, b) => b.finalScore - a.finalScore)
  if (contradicting.length) {
    sections.push({
      heading: 'Strongest contradicting evidence',
      bullets: contradicting.slice(0, 3).map(quoteLine),
      tone: 'risk',
      evidenceType: 'Customer Voice',
    })
  }

  if (p.affectedUsers.length) {
    sections.push({
      heading: 'Affected users',
      bullets: p.affectedUsers.map((u) => `${u.segment} (${u.mentions})`),
      tone: 'default',
      evidenceType: 'Customer Voice',
    })
  }

  // Evidence-level framing — absence of evidence is NOT evidence of absent demand.
  if (p.evidenceLevel === 'No evidence found') {
    sections.push({
      heading: 'Customer evidence',
      body: 'No public customer evidence found for these claims. This reflects discussion availability, not absence of demand — validate directly with target users.',
      tone: 'unknown',
    })
  } else if (p.evidenceLevel === 'Limited evidence found') {
    sections.push({
      heading: 'Customer evidence',
      body: 'Limited public evidence — signal is thin or mixed. Treat as directional and validate with target users.',
      tone: 'unknown',
    })
  }

  return sections
}
