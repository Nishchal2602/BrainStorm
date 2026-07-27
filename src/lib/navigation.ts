// Jump-to-PRD navigation: pure reference resolution shared by the side panel
// (which resolves against the review-time document map) and typed contracts for
// the injected locator (which re-finds the target in the live DOM).
//
// The public entry for UI code is a JumpReference — a superset object so every
// future finding type (voice claims, competitor rows, missing requirements)
// reuses the same API by populating richer fields; today only `where` is set.

/** One heading captured at extraction time. */
export interface DocHeading {
  level: number
  text: string
  /** Best-available DOM anchor id (own id / inner anchor / wrapper) if any. */
  id?: string
  /** Ancestor heading texts, outermost first (for disambiguation). */
  path: string[]
  /** Enclosing [data-block-id] when present (Notion) — a session-scope fast path for apply. */
  blockId?: string
}

/** The document map captured when the review ran (persisted on ReviewData). */
export interface DocMap {
  url: string
  headings: DocHeading[]
}

/** A navigable reference from any finding type. Today only `where` is populated. */
export interface JumpReference {
  /** Free-text location from the model ("Section 4: Onboarding" or a quote). */
  where?: string
  /** Exact heading text, when the caller already knows it. */
  heading?: string
  /** Verbatim quote to locate, when the caller has one. */
  excerpt?: string
  /** Review-time document map (from ReviewData.docMap). */
  docMap?: DocMap
}

/** What the injected locator receives — the best strategy first, with fallbacks. */
export type ResolvedTarget =
  | { kind: 'id'; id: string; headingText: string }
  | { kind: 'heading'; headingText: string; path: string[] }
  | { kind: 'excerpt'; excerpt: string }

/** Lowercase, strip punctuation, collapse whitespace — tolerant text identity. */
export function normalizeRef(s: string): string {
  return s
    .toLowerCase()
    .replace(/["'“”‘’`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Strip leading "Section 4:", "4.2", "11.1", "Part II —" style prefixes.
 *
 * The numeric rule is deliberately two separate patterns:
 *  - multi-level ("11.1 Foo", "2.1.3 Foo") needs NO trailing delimiter, and must
 *    consume every level. A single greedy pattern with an optional delimiter
 *    backtracks and lets the DOT act as the delimiter, so "11.1 Foo" used to come
 *    back as "1 Foo" — which silently broke every section lookup on a numbered PRD.
 *  - single-level requires an explicit delimiter ("1. Foo", "3) Foo"), so a heading
 *    that merely opens with a number ("2024 Roadmap") keeps it.
 * Both require whitespace after the prefix, so "4.2Foo" is left alone.
 */
export function stripSectionPrefix(s: string): string {
  return s
    .replace(/^\s*(section|part|chapter|§)\s*[\dIVXivx]+(\.\d+)*\s*[:.\-–—]?\s*/i, '')
    .replace(/^\s*\d+(?:\.\d+)+[.):\-–—]?(?=\s)\s*/, '')
    .replace(/^\s*\d+[.):\-–—](?=\s)\s*/, '')
    .trim()
}

/**
 * Comparable identity for a heading, from EITHER a DocHeading.text or a raw line of
 * extracted markdown. Strips markdown `#` markers, then the section prefix, then
 * normalizes — so "## 11.1 Workout Generation" and "11.1 Workout Generation" and
 * "Workout Generation" all collapse to the same key.
 *
 * Both sides of every heading comparison MUST go through this. Comparing a
 * prefix-stripped target against an unstripped line is what made numbered headings
 * unresolvable.
 */
export function headingKey(s: string): string {
  return normalizeRef(stripSectionPrefix(s.replace(/^\s*#{1,6}\s*/, '')))
}

const tokens = (s: string): Set<string> => new Set(normalizeRef(s).split(' ').filter((t) => t.length >= 3))

/** Count of tokens present in both strings. */
function sharedTokens(a: string, b: string): number {
  const tb = tokens(b)
  let hit = 0
  for (const t of tokens(a)) if (tb.has(t)) hit++
  return hit
}

/** Jaccard-ish token overlap in [0,1] (intersection over the smaller set). */
function overlap(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (!ta.size || !tb.size) return 0
  return sharedTokens(a, b) / Math.min(ta.size, tb.size)
}

function toTarget(h: DocHeading): ResolvedTarget {
  return h.id
    ? { kind: 'id', id: h.id, headingText: h.text }
    : { kind: 'heading', headingText: h.text, path: h.path }
}

/** A quote-like reference: long, sentence-shaped text that won't be a heading. */
function looksLikeQuote(where: string): boolean {
  return where.length > 80 || /^["'“”]/.test(where.trim())
}

/**
 * How tolerant a match may be. The two callers have opposite failure costs:
 *  - jump-to-PRD: a wrong match scrolls somewhere unhelpful. Cheap. Be lenient.
 *  - anchoring / apply: a wrong match WRITES INTO THE WRONG SECTION of the user's
 *    PRD. Expensive and silent. Be strict — an unanchored patch (Apply disabled,
 *    Copy and Retry still available) is strictly better than a confidently
 *    misplaced one.
 *
 * At the old shared threshold of 0.5, all of these matched: "Error Handling" →
 * "Error Codes", "Acceptance Criteria" → "Success Criteria", "Card Data Retention"
 * → "Data Model", "Compliance Review" → "Design Review".
 */
export interface MatchStrictness {
  /** Minimum token overlap for the fuzzy tier. */
  minOverlap: number
  /** Minimum number of overlapping tokens (0.5 on two tokens is one word). */
  minTokens: number
  /** Reject substring matches against single-token candidates ("Data" vs "Data Retention Policy"). */
  requireMultiTokenSubstring: boolean
}

export const LENIENT_MATCH: MatchStrictness = {
  minOverlap: 0.5,
  minTokens: 1,
  requireMultiTokenSubstring: false,
}

/** Used by anchoring, apply and grounding — anywhere a wrong section mutates the doc. */
export const STRICT_MATCH: MatchStrictness = {
  minOverlap: 0.7,
  minTokens: 2,
  requireMultiTokenSubstring: true,
}

const tokenCount = (s: string): number => tokens(s).size

/**
 * The single heading-matching ladder, shared by jump-to-PRD (resolveReference),
 * local patch anchoring, and Notion apply. Given a target and candidate heading
 * texts, returns the index of the best match, or null when nothing is good
 * enough. Ladder, most → least precise:
 *   1. exact match on headingKey (markdown markers + section prefix stripped)
 *   2. bidirectional substring (either contains the other), longest candidate wins
 *   3. token-overlap fuzzy ≥ strictness.minOverlap
 * Both sides go through headingKey, so "11.1 Foo" matches "## 11.1 Foo" matches "Foo".
 */
export function matchHeading(
  target: string,
  candidates: string[],
  strictness: MatchStrictness = LENIENT_MATCH,
): number | null {
  const normWhere = headingKey(target)
  if (!normWhere || !candidates.length) return null

  const norm = candidates.map((c) => headingKey(c))

  // 1. Exact match.
  const exact = norm.findIndex((h) => h === normWhere)
  if (exact !== -1) return exact

  // 2. Bidirectional substring; prefer the longest candidate = most specific.
  let subIdx: number | null = null
  let subLen = -1
  for (let i = 0; i < candidates.length; i++) {
    const ht = norm[i]
    if (ht.length < 4) continue
    if (strictness.requireMultiTokenSubstring && tokenCount(ht) < 2) continue
    if ((ht.includes(normWhere) || normWhere.includes(ht)) && candidates[i].length > subLen) {
      subIdx = i
      subLen = candidates[i].length
    }
  }
  if (subIdx !== null) return subIdx

  // 3. Token-overlap fuzzy match (resilient to minor edits/rewording).
  let best: number | null = null
  let bestScore = 0
  let bestHits = 0
  for (let i = 0; i < candidates.length; i++) {
    const score = overlap(normWhere, norm[i])
    if (score > bestScore) {
      bestScore = score
      best = i
      bestHits = sharedTokens(normWhere, norm[i])
    }
  }
  return best !== null &&
    bestScore >= strictness.minOverlap &&
    bestHits >= strictness.minTokens &&
    !looksLikeQuote(target)
    ? best
    : null
}

/**
 * Resolve a JumpReference to the best locator target using the review-time
 * document map. Lookup order: explicit heading/excerpt → exact heading match →
 * bidirectional substring → token-overlap fuzzy → excerpt fallback. Returns
 * null only when the reference has no usable text.
 */
export function resolveReference(ref: JumpReference): ResolvedTarget | null {
  const headings = ref.docMap?.headings ?? []

  // Explicit fields win — callers that know more get exactly what they asked for.
  if (ref.heading?.trim()) {
    const norm = headingKey(ref.heading)
    const hit = headings.find((h) => headingKey(h.text) === norm)
    return hit ? toTarget(hit) : { kind: 'heading', headingText: ref.heading.trim(), path: [] }
  }
  if (ref.excerpt?.trim()) return { kind: 'excerpt', excerpt: ref.excerpt.trim() }

  const where = ref.where?.trim()
  if (!where) return null

  const cleaned = stripSectionPrefix(where)

  if (headings.length) {
    // Delegate the heading ladder to the shared matcher (one implementation).
    const idx = matchHeading(where, headings.map((h) => h.text))
    if (idx !== null) return toTarget(headings[idx])
  }

  // 4. Quote-like or unmatched text → let the locator fuzzy-find it in the body.
  if (looksLikeQuote(where) || !headings.length) return { kind: 'excerpt', excerpt: cleaned || where }

  // Short section-ish text that matched nothing: still try as a heading in the
  // live DOM (the map may be stale) with an excerpt-style last resort there.
  return { kind: 'heading', headingText: cleaned || where, path: [] }
}

/** Same document = same origin + pathname (hash/query are navigation noise). */
export function sameDoc(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  try {
    const ua = new URL(a)
    const ub = new URL(b)
    return ua.origin === ub.origin && ua.pathname.replace(/\/$/, '') === ub.pathname.replace(/\/$/, '')
  } catch {
    return a === b
  }
}
