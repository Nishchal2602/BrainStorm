import type { CapabilityCell, Competitor, DocumentAnalysis, LandscapeSignal } from '../../types'
import { normalizeCapability } from './extraction'

/** Direct-competitor count at which the market reads as saturated. */
const SAT_FULL = 6

const clamp01 = (n: number): number => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0))

export interface DifferentiationResult {
  differentiationScore: number
  differentiation: 'Low' | 'Medium' | 'High'
  scoreFactors: { novelty: number; coverage: number; saturation: number; missingStandards: number }
}

/** Rarity of a planned capability in the market (1 = nobody has it). */
function rarityWeight(adoption: number, frac: number): number {
  if (adoption === 0) return 1
  if (adoption <= 2) return 0.6
  if (frac < 0.5) return 0.35
  return 0.1
}

/** Step 5 (PURE): Differentiation = 0.35·Novelty + 0.30·Coverage + 0.20·Saturation + 0.15·MissingStandards (#9). */
export function scoreDifferentiation(
  planned: string[],
  cells: CapabilityCell[],
  competitors: Competitor[],
): DifferentiationResult {
  const zero = { novelty: 0, coverage: 0, saturation: 0, missingStandards: 0 }
  // Can't assess differentiation without a mapped market — never reads as "highly differentiated".
  if (!competitors.length) return { differentiationScore: 0, differentiation: 'Low', scoreFactors: zero }

  const competitorCount = competitors.length
  const plannedSet = new Set(planned.map((p) => normalizeCapability(p).toLowerCase()))
  const byName = new Map(cells.map((c) => [c.name.toLowerCase(), c]))

  // Novelty: how rare the planned capabilities are across the market.
  const plannedCells = [...plannedSet]
    .map((k) => byName.get(k))
    .filter((c): c is CapabilityCell => !!c)
  const novelty = plannedCells.length
    ? plannedCells.reduce((s, c) => s + rarityWeight(c.adoption, c.adoption / competitorCount), 0) /
      plannedCells.length
    : 0

  // Coverage: breadth — how much of what the market offers the proposal also covers.
  const marketCaps = cells.filter((c) => c.adoption > 0)
  const plannedInMarket = marketCaps.filter((c) => plannedSet.has(c.name.toLowerCase()))
  const coverage = marketCaps.length ? plannedInMarket.length / marketCaps.length : 0

  // MissingStandards: of the table-stakes capabilities (offered by most), how many are covered.
  const standards = marketCaps.filter((c) => c.adoption / competitorCount >= 0.5)
  const missing = standards.filter((c) => !plannedSet.has(c.name.toLowerCase())).length
  const missingStandards = standards.length ? 1 - missing / standards.length : 1

  // Saturation: fewer DIRECT competitors ⇒ more room to differentiate.
  const directCount = competitors.filter((c) => c.relationship === 'direct').length
  const saturation = 1 - Math.min(1, directCount / SAT_FULL)

  const factors = {
    novelty: clamp01(novelty),
    coverage: clamp01(coverage),
    saturation: clamp01(saturation),
    missingStandards: clamp01(missingStandards),
  }
  const score = Math.round(
    100 *
      (0.35 * factors.novelty +
        0.3 * factors.coverage +
        0.2 * factors.saturation +
        0.15 * factors.missingStandards),
  )
  const differentiation = score >= 70 ? 'High' : score >= 40 ? 'Medium' : 'Low'
  return { differentiationScore: score, differentiation, scoreFactors: factors }
}

// Well-known players by category — a sanity check that grounding didn't miss the obvious (#8).
const KNOWN_PLAYERS: { match: RegExp; players: string[] }[] = [
  { match: /enterprise search|workplace search/i, players: ['Glean', 'Guru', 'Elastic'] },
  { match: /enterprise ai|company context|internal knowledge|workplace assistant|knowledge management/i, players: ['Glean', 'Guru', 'Microsoft Copilot', 'Notion AI'] },
  { match: /ai cod|code (assistant|completion)|developer tool/i, players: ['Cursor', 'GitHub Copilot'] },
  { match: /\bcrm\b|customer relationship/i, players: ['Salesforce', 'HubSpot'] },
  { match: /project management|issue track/i, players: ['Jira', 'Linear', 'Asana'] },
]

/** Flag a likely-incomplete landscape (expected players absent) or a crowded market (#8). */
export function landscapeSignals(
  analysis: DocumentAnalysis | undefined,
  competitors: Competitor[],
): LandscapeSignal[] {
  const signals: LandscapeSignal[] = []
  const hay = `${analysis?.productCategory ?? ''} ${analysis?.solutionCategory ?? ''} ${(analysis?.keyCapabilities ?? []).join(' ')}`.toLowerCase()
  const found = competitors.map((c) => c.name.toLowerCase())
  for (const entry of KNOWN_PLAYERS) {
    if (!entry.match.test(hay)) continue
    const present = entry.players.some((p) => found.some((f) => f.includes(p.toLowerCase())))
    if (!present) {
      signals.push({
        kind: 'incomplete_landscape',
        message: `Expected players (${entry.players.join(', ')}) were not found — the landscape may be incomplete; verify directly.`,
      })
    }
    break // only the first matching category
  }
  const direct = competitors.filter((c) => c.relationship === 'direct').length
  if (direct >= SAT_FULL) {
    signals.push({ kind: 'crowded', message: `${direct} direct competitors — this is a crowded market.` })
  }
  return signals
}
