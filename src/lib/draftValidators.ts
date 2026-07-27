import { normalizeRef } from '@/lib/navigation'
import type { SectionView } from '@/lib/sectionView'

// Deterministic "self-review" for a generated draft.
//
// Every rule here enforces something PATCH_RULES already TELLS the model to do
// ("avoid repeating existing text", "never instructions", "preserve bullet style").
// Instructions alone demonstrably don't hold, and asking a model to grade its own
// prose is both unreliable and doubles the cost — whereas each of these failures is
// mechanically detectable in microseconds. Violations are coded so a single bounded
// repair call can name exactly what to fix.

export type ViolationCode =
  | 'DUPLICATE_LINE'
  | 'INSTRUCTION_LEAKAGE'
  | 'INVENTED_HEADING'
  | 'BULLET_MARKER_MISMATCH'
  | 'EMPTY'
  | 'TOO_LONG'

export interface Violation {
  code: ViolationCode
  /** Shown to the model in the repair prompt — must be actionable and specific. */
  message: string
}

export interface DraftValidation {
  ok: boolean
  violations: Violation[]
}

/**
 * Phrases that mean the model described the fix instead of writing the PRD text.
 * PATCH_RULES bans these explicitly; this is the enforcement.
 */
const LEAKAGE = [
  /^\s*you\s+(should|must|will|can|need)/i,
  /^\s*(consider|ensure|define|specify|add|include|document|clarify)\s+/i,
  /^\s*here('|’)?s?\s+(is|are|the)/i,
  /^\s*(this|the following)\s+(section|patch|text|addition)\s+/i,
  /\b(TBD|TODO|FIXME|XXX)\b/,
  /\[(insert|add|your|to be)\b[^\]]*\]/i,
  /^\s*(note|tip|reminder):/i,
]

/** A line is "meaningful" if it carries prose, not just a marker or blank. */
const meaningful = (line: string): boolean => normalizeRef(line).length >= 8

/** Strip list/quote/heading markers so content is compared, not syntax. */
function stripMarker(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/^\s*>\s?/, '')
    .trim()
}

const MAX_DRAFT_CHARS = 4000

/**
 * Validate a generated draft against the section it will land in.
 *
 * `view` may be absent (the ungrounded fallback path) — the content-independent
 * rules still run, so a leaked instruction is caught either way.
 */
export function validateDraft(content: string, view?: SectionView): DraftValidation {
  const violations: Violation[] = []
  const lines = content.split('\n')
  const bodyLines = lines.filter((l) => l.trim())

  if (!bodyLines.length) {
    return { ok: false, violations: [{ code: 'EMPTY', message: 'The draft is empty.' }] }
  }

  if (content.length > MAX_DRAFT_CHARS) {
    violations.push({
      code: 'TOO_LONG',
      message: `The draft is ${content.length} characters; keep it under ${MAX_DRAFT_CHARS}. Write only what resolves the issue.`,
    })
  }

  // 1 — Instruction leakage: advice about the PRD instead of PRD text.
  for (const line of bodyLines) {
    const bare = stripMarker(line)
    const hit = LEAKAGE.find((re) => re.test(bare))
    if (hit) {
      violations.push({
        code: 'INSTRUCTION_LEAKAGE',
        message: `This line instructs rather than states: "${bare.slice(0, 80)}". Write the finished PRD text, not advice about it.`,
      })
      break // one example is enough to steer a repair
    }
  }

  if (view) {
    // 2 — Duplication, per line. Today's apply-time check only looks at the
    // draft's FIRST line, so a draft whose 3rd bullet already exists slips through.
    const existing = view.lines.map((l) => normalizeRef(stripMarker(l.text))).filter(Boolean)
    for (const line of bodyLines) {
      const norm = normalizeRef(stripMarker(line))
      if (!norm || !meaningful(line)) continue
      if (existing.some((e) => e === norm || (e.length > 20 && e.includes(norm)))) {
        violations.push({
          code: 'DUPLICATE_LINE',
          message: `This content is already in the section: "${stripMarker(line).slice(0, 80)}". Remove it and add only what is missing.`,
        })
        break
      }
    }

    // 3 — Invented heading: the section exists, so re-declaring it duplicates it.
    // This is the single most visible failure of the ungrounded prompt.
    const targetNorm = normalizeRef(view.headingText)
    for (const line of bodyLines) {
      if (!/^\s*#{1,6}\s+/.test(line)) continue
      if (normalizeRef(stripMarker(line)) === targetNorm) {
        violations.push({
          code: 'INVENTED_HEADING',
          message: `Do not repeat the heading "${view.headingText}" — you are writing the body of that existing section.`,
        })
        break
      }
    }

    // 4 — Bullet marker must match the section's own convention.
    if (view.bulletMarker) {
      const wrong = bodyLines.find((l) => {
        const m = l.match(/^\s*([-*+])\s+/)
        return m && m[1] !== view.bulletMarker
      })
      if (wrong) {
        violations.push({
          code: 'BULLET_MARKER_MISMATCH',
          message: `This section uses "${view.bulletMarker} " for bullets; use the same marker.`,
        })
      }
    }
  }

  return { ok: violations.length === 0, violations }
}

/** Codes only — safe to log/record (never carries draft or PRD text). */
export const violationCodes = (v: Violation[]): string[] => v.map((x) => x.code)
