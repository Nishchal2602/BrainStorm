import type { Confidence, Section, SectionTone } from '@/lib/types'
import type { AgentResult, Competitor, CompetitorPayload, CompetitorRelationship } from '../../types'

const confBand = (n: number): Confidence => (n >= 70 ? 'High' : n >= 40 ? 'Medium' : 'Low')

const REL_GROUPS: { rel: CompetitorRelationship; heading: string; tone: SectionTone }[] = [
  { rel: 'direct', heading: 'Direct competitors', tone: 'risk' },
  { rel: 'adjacent', heading: 'Adjacent products', tone: 'insight' },
  { rel: 'substitute', heading: 'Substitutes', tone: 'default' },
]

const positioningLine = (c: Competitor): string => {
  const head = `${c.name} (${c.confidence}%) — ${c.primaryJob || c.category}${c.architecture && c.architecture !== 'Unknown' ? ` · ${c.architecture}` : ''}`
  return c.relationshipReason ? `${head} — ${c.relationshipReason}` : head
}

/** Render the competitive landscape as a PM analysis: landscape, segments, positioning,
 * strategic white space, differentiation. Reuses Section/Card; [] for non-ok/absent. */
export function competitorSections(results: AgentResult[]): Section[] {
  const result = results.find((r) => r.agentId === 'competitor')
  if (!result || result.status !== 'ok') return []
  const p = result.data as CompetitorPayload | undefined
  if (!p || !p.landscape) return []
  const land = p.landscape

  // No competitors located — framed as coverage, never "no competition".
  if (!land.competitors.length) {
    return [
      {
        heading: 'Market Landscape',
        body: p.recommendation || 'No competitors identified from available evidence — validate the market directly.',
        tone: 'unknown',
        evidenceType: 'Competitor',
      },
    ]
  }

  const sections: Section[] = []
  const total = p.competitorsFound

  // Market Landscape headline.
  sections.push({
    heading: `Market Landscape — ${total} competitor${total === 1 ? '' : 's'}`,
    body: `${land.category || p.productCategory} · Maturity ${land.maturity} · ${p.differentiation} differentiation (${p.differentiationScore}/100)`,
    bullets: land.competitors.slice(0, 6).map((c) => `${c.name} — ${c.category}`),
    tone: 'insight',
    evidenceType: 'Competitor',
    confidence: confBand(p.differentiationScore),
  })

  // Market Segments.
  if (land.segments.length) {
    sections.push({
      heading: 'Market segments',
      bullets: land.segments
        .filter((s) => s.competitors.length)
        .map((s) => `${s.name} — ${s.competitors.join(', ')}`),
      tone: 'default',
      evidenceType: 'Competitor',
    })
  }

  // Competitor Positioning, grouped Direct / Adjacent / Substitute.
  for (const g of REL_GROUPS) {
    const group = land.competitors.filter((c) => c.relationship === g.rel)
    if (!group.length) continue
    sections.push({
      heading: g.heading,
      bullets: group.slice(0, 6).map(positioningLine),
      tone: g.tone,
      evidenceType: 'Competitor',
    })
  }

  // Strategic White Space (absence-justified).
  if (land.whiteSpace.length) {
    sections.push({
      heading: 'Strategic white space',
      bullets: land.whiteSpace
        .slice(0, 6)
        .map((w) => (w.rationale ? `${w.opportunity} — ${w.rationale}` : w.opportunity)),
      tone: 'insight',
      evidenceType: 'Competitor',
    })
  }

  // Differentiation Assessment — narrative + the four sub-scores.
  const sf = p.differentiationScores
  sections.push({
    heading: `Differentiation assessment — ${p.differentiation}`,
    body: `${p.recommendation}\nPositioning ${sf.positioningDifferentiation} · Architecture ${sf.architectureNovelty} · Capability ${sf.capabilityDifferentiation} · Market overlap ${sf.marketOverlap} → ${p.differentiationScore}/100`,
    tone: 'recommendation',
    confidence: confBand(p.differentiationScore),
  })

  // Caveats.
  for (const s of land.signals) {
    sections.push({
      heading: s.kind === 'crowded' ? 'Crowded market' : 'Possible incomplete landscape',
      body: s.message,
      tone: s.kind === 'crowded' ? 'risk' : 'unknown',
    })
  }

  return sections
}
