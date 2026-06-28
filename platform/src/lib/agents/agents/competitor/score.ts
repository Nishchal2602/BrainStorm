import type { Competitor, DifferentiationScores, DocumentAnalysis, LandscapeSignal } from '../../types'

/** Direct-competitor count at which the market reads as saturated. */
const SAT_FULL = 6

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : 0))
const s100 = (n: number): number => clamp(n, 0, 100)

export interface DifferentiationResult {
  differentiationScore: number
  differentiation: 'Low' | 'Medium' | 'High'
}

/** Step 5 (PURE): apply fixed weights to the LLM's four sub-scores. Positioning +
 * architecture dominate, so feature overlap can't alone drive the result (#6/#9). */
export function weightDifferentiation(scores: DifferentiationScores): DifferentiationResult {
  const positioning = s100(scores.positioningDifferentiation)
  const architecture = s100(scores.architectureNovelty)
  const capability = s100(scores.capabilityDifferentiation)
  const overlap = s100(scores.marketOverlap)
  const differentiationScore = Math.round(
    0.3 * positioning + 0.3 * architecture + 0.2 * capability + 0.2 * (100 - overlap),
  )
  const differentiation =
    differentiationScore >= 70 ? 'High' : differentiationScore >= 40 ? 'Medium' : 'Low'
  return { differentiationScore, differentiation }
}

// Well-known players by category — a sanity check that grounding didn't miss the obvious.
const KNOWN_PLAYERS: { match: RegExp; players: string[] }[] = [
  { match: /enterprise search|workplace search/i, players: ['Glean', 'Guru', 'Elastic'] },
  { match: /enterprise ai|company context|internal knowledge|workplace assistant|knowledge management/i, players: ['Glean', 'Moveworks', 'Microsoft Copilot', 'Notion AI'] },
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
    break
  }
  const direct = competitors.filter((c) => c.relationship === 'direct').length
  if (direct >= SAT_FULL) {
    signals.push({ kind: 'crowded', message: `${direct} direct competitors — this is a crowded market.` })
  }
  return signals
}

/** Suggested adjacent categories for the zero-competitor case (never "no competition"). */
export function adjacentCategorySuggestions(analysis: DocumentAnalysis | undefined): string[] {
  const hay = `${analysis?.productCategory ?? ''} ${analysis?.solutionCategory ?? ''}`.toLowerCase()
  for (const entry of KNOWN_PLAYERS) {
    if (entry.match.test(hay)) return entry.players
  }
  return []
}
