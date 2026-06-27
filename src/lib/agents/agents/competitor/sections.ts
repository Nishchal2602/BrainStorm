import type { Confidence, Section, SectionTone } from '@/lib/types'
import type {
  AgentResult,
  CapabilityCell,
  Competitor,
  CompetitorPayload,
  CompetitorRelationship,
} from '../../types'

const pct = (n: number): number => Math.round(n * 100)
const confBand = (n: number): Confidence => (n >= 70 ? 'High' : n >= 40 ? 'Medium' : 'Low')
const maturityLabel = (m: string): string => m.replace(/_/g, ' ')

const REL_GROUPS: { rel: CompetitorRelationship; heading: string; tone: SectionTone }[] = [
  { rel: 'direct', heading: 'Direct competitors', tone: 'risk' },
  { rel: 'indirect', heading: 'Indirect competitors', tone: 'insight' },
  { rel: 'adjacent', heading: 'Adjacent products', tone: 'default' },
]

const competitorLine = (c: Competitor): string =>
  `${c.name} (${c.confidence}%) — ${c.positioning || c.jobApproach || '—'}${c.url ? ` ${c.url}` : ''}`.trim()

const capCell = (cell: CapabilityCell, total: number): string =>
  `${cell.name} — ${cell.adoption}/${total} · ${maturityLabel(cell.maturity)} · ${cell.status}`

/** Render the competitive landscape as research cards: who solves the job, capability
 * comparison, white space, and differentiation. Reuses Section/Card; [] for non-ok/absent. */
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
        heading: 'Competitor Landscape',
        body: 'Could not map the competitive landscape — no competitors located. This reflects search coverage, not an absence of competition; validate the market directly.',
        tone: 'unknown',
        evidenceType: 'Competitor',
      },
    ]
  }

  const sections: Section[] = []
  const total = p.competitorsFound

  sections.push({
    heading: `Competitor Landscape — ${total} competitor${total === 1 ? '' : 's'}`,
    body: `${p.productCategory} · ${p.differentiation} differentiation (${p.differentiationScore}/100)`,
    tone: 'insight',
    evidenceType: 'Competitor',
    confidence: confBand(p.differentiationScore),
  })

  // Competitors grouped Direct / Indirect / Adjacent (#6).
  for (const g of REL_GROUPS) {
    const group = land.competitors.filter((c) => c.relationship === g.rel)
    if (!group.length) continue
    sections.push({
      heading: g.heading,
      bullets: group.slice(0, 6).map(competitorLine),
      tone: g.tone,
      evidenceType: 'Competitor',
    })
  }

  // Jobs-to-be-done (#10) — same job, different implementations.
  const primaryJob = land.jobs.find((j) => j.approaches.length)
  if (primaryJob) {
    sections.push({
      heading: `Job: ${primaryJob.job}`,
      bullets: primaryJob.approaches.slice(0, 6).map((a) => `${a.competitor} — ${a.approach}`),
      tone: 'default',
      evidenceType: 'Competitor',
    })
  }

  // Capability comparison (adoption + maturity + evidence URLs).
  const byName = new Map(land.competitors.map((c) => [c.name.toLowerCase(), c]))
  if (land.capabilities.length) {
    sections.push({
      heading: 'Capability comparison',
      bullets: land.capabilities.slice(0, 10).map((cell) => {
        const owner = byName.get((cell.competitors[0] ?? '').toLowerCase())
        const cap = owner?.capabilities.find((c) => c.name.toLowerCase() === cell.name.toLowerCase())
        const url = cap?.evidence.url
        return `${capCell(cell, total)}${url ? ` — ${url}` : ''}`
      }),
      tone: 'insight',
      evidenceType: 'Competitor',
    })
  }

  // White space — differentiators (Unique/Rare) and gaps (Missing).
  const diff = land.capabilities.filter((c) => c.status === 'Unique' || c.status === 'Rare')
  const missing = land.capabilities.filter((c) => c.status === 'Missing')
  if (diff.length || missing.length) {
    const bullets: string[] = []
    for (const c of diff.slice(0, 5)) bullets.push(`Differentiator — ${c.name} (${c.status}, in ${c.adoption}/${total})`)
    for (const c of missing.slice(0, 5)) bullets.push(`Missing — ${c.name} (in ${c.adoption}/${total} competitors, absent from proposal)`)
    sections.push({ heading: 'White space', bullets, tone: 'insight', evidenceType: 'Competitor' })
  }

  // Differentiation breakdown.
  const sf = p.scoreFactors
  sections.push({
    heading: `${p.differentiation} differentiation`,
    body: `Score ${p.differentiationScore}/100 — Novelty ${pct(sf.novelty)}% · Coverage ${pct(sf.coverage)}% · Saturation room ${pct(sf.saturation)}% · Standards covered ${pct(sf.missingStandards)}%`,
    tone: 'recommendation',
    confidence: confBand(p.differentiationScore),
  })

  // Caveats (incomplete landscape / crowded) (#8).
  for (const s of land.signals) {
    sections.push({
      heading: s.kind === 'crowded' ? 'Crowded market' : 'Possible incomplete landscape',
      body: s.message,
      tone: s.kind === 'crowded' ? 'risk' : 'unknown',
    })
  }

  return sections
}
