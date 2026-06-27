import type { CapabilityCell, Competitor, GapStatus, Maturity } from '../../types'
import { normalizeCapability } from './extraction'

/** Adoption fraction → market maturity band (#7). */
function maturityOf(frac: number): Maturity {
  if (frac <= 0) return 'very_emerging'
  if (frac < 0.25) return 'emerging'
  if (frac < 0.5) return 'maturing'
  if (frac < 0.8) return 'mature'
  return 'very_mature'
}

/** Capability standing vs the proposal + market (#5). */
function statusOf(isPlanned: boolean, adoption: number, frac: number): GapStatus {
  if (isPlanned) {
    if (adoption === 0) return 'Unique'
    if (adoption <= 2) return 'Rare'
    if (frac >= 0.8) return 'Commodity'
    return 'Common'
  }
  // A market capability the proposal does not list.
  if (frac >= 0.6) return 'Missing'
  if (adoption <= 2) return 'Rare'
  return 'Common'
}

/** Step 4 (PURE): roll capabilities across competitors into matrix cells, including
 * planned capabilities at 0 adoption so Unique/Missing white space is visible. */
export function buildCapabilityCells(competitors: Competitor[], planned: string[]): CapabilityCell[] {
  const competitorCount = competitors.length
  const plannedSet = new Set(planned.map((p) => normalizeCapability(p).toLowerCase()))

  const map = new Map<string, { name: string; competitors: string[] }>()
  for (const c of competitors) {
    for (const cap of c.capabilities) {
      const key = cap.name.toLowerCase()
      const e = map.get(key) ?? { name: cap.name, competitors: [] }
      if (!e.competitors.includes(c.name)) e.competitors.push(c.name)
      map.set(key, e)
    }
  }
  for (const p of planned) {
    const name = normalizeCapability(p)
    const key = name.toLowerCase()
    if (!map.has(key)) map.set(key, { name, competitors: [] })
  }

  const cells: CapabilityCell[] = [...map.values()].map((e) => {
    const adoption = e.competitors.length
    const frac = competitorCount > 0 ? adoption / competitorCount : 0
    return {
      name: e.name,
      adoption,
      competitors: e.competitors,
      maturity: maturityOf(frac),
      status: statusOf(plannedSet.has(e.name.toLowerCase()), adoption, frac),
    }
  })
  return cells.sort((a, b) => b.adoption - a.adoption || a.name.localeCompare(b.name))
}
