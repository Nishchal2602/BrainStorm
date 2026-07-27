import type { DocHeading } from '@/lib/navigation'
import type { Industry } from '@/lib/types'
import type { ObligationGap, ObligationPack } from './types'
import { TECHNICAL_PACKS } from './packs/technical'
import { COMPLIANCE_PACKS } from './packs/compliance'

// Deterministic coverage detection. No LLM, no network, runs in microseconds.
//
// MUST be called with the FULL untruncated document (raw.content), not the
// truncated context the model receives. The whole safety property depends on it:
// we only assert an obligation is unmet after searching the COMPLETE text for
// evidence, so a spec buried in the omitted middle can never be reported missing.

export const ALL_PACKS: readonly ObligationPack[] = [...TECHNICAL_PACKS, ...COMPLIANCE_PACKS]

/** Cap the injected checklist so a broad PRD can't flood the prompt. */
const MAX_GAPS = 14

function packApplies(pack: ObligationPack, industry?: Industry | ''): boolean {
  const allowed = pack.appliesWhen?.industry
  if (!allowed) return true
  // No industry captured → don't gate it out; entity detection still has to fire.
  if (!industry) return true
  return allowed.includes(industry)
}

/** First heading whose section mentions the entity, so a draft can target it. */
function mentionHeading(text: string, headings: DocHeading[], detect: RegExp[]): string | undefined {
  if (!headings.length) return undefined
  const lines = text.split('\n')
  // Walk the doc tracking the current heading; return the heading in force at the
  // first line that matches. Cheap and good enough — the model still confirms.
  const headingTexts = new Set(headings.map((h) => h.text.trim()))
  let current: string | undefined
  for (const line of lines) {
    const bare = line.replace(/^\s*#{1,6}\s*/, '').trim()
    if (headingTexts.has(bare)) {
      current = bare
      continue
    }
    if (detect.some((re) => re.test(line))) return current
  }
  return undefined
}

/**
 * Detect which obligations a document leaves UNMET.
 *
 * Two independent passes per pack:
 *  1. `detect` — is this entity present at all? (no → skip the whole pack)
 *  2. `probe`  — is each attribute already specified anywhere? (yes → skip it)
 *
 * Only the survivors are returned, so the prompt carries a short, specific list of
 * closed questions rather than a generic "find what's missing".
 */
export function detectObligations(
  fullText: string,
  headings: DocHeading[] = [],
  opts: { industry?: Industry | ''; packs?: readonly ObligationPack[]; maxGaps?: number } = {},
): ObligationGap[] {
  if (!fullText.trim()) return []
  const packs = opts.packs ?? ALL_PACKS
  const gaps: ObligationGap[] = []

  for (const pack of packs) {
    if (!packApplies(pack, opts.industry)) continue
    if (!pack.detect.some((re) => re.test(fullText))) continue

    const targetHeading = mentionHeading(fullText, headings, pack.detect)

    for (const obligation of pack.obligations) {
      // Evidence anywhere in the FULL text suppresses the obligation.
      if (obligation.probe.some((re) => re.test(fullText))) continue
      gaps.push({
        packId: pack.id,
        packLabel: pack.label,
        kind: pack.kind,
        source: pack.source,
        obligation,
        targetHeading,
      })
    }
  }

  // Compliance first, then by severity — the checklist is capped, so the most
  // consequential gaps must survive the cut.
  const sevRank = { critical: 0, medium: 1, minor: 2 } as const
  gaps.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'compliance' ? -1 : 1
    return sevRank[a.obligation.severity] - sevRank[b.obligation.severity]
  })
  return gaps.slice(0, opts.maxGaps ?? MAX_GAPS)
}

/** Which packs fired, for logging. Metadata only — never document text. */
export function detectedPackIds(
  fullText: string,
  opts: { industry?: Industry | '' } = {},
): string[] {
  return ALL_PACKS.filter(
    (p) => packApplies(p, opts.industry) && p.detect.some((re) => re.test(fullText)),
  ).map((p) => p.id)
}
