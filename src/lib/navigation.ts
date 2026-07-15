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

/** Strip leading "Section 4:", "4.2", "Part II —" style prefixes. */
function stripSectionPrefix(s: string): string {
  return s
    .replace(/^\s*(section|part|chapter|§)\s*[\dIVXivx]+(\.\d+)*\s*[:.\-–—]?\s*/i, '')
    .replace(/^\s*\d+(\.\d+)*\s*[:.\-–—)]\s*/, '')
    .trim()
}

const tokens = (s: string): Set<string> => new Set(normalizeRef(s).split(' ').filter((t) => t.length >= 3))

/** Jaccard-ish token overlap in [0,1] (intersection over the smaller set). */
function overlap(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (!ta.size || !tb.size) return 0
  let hit = 0
  for (const t of ta) if (tb.has(t)) hit++
  return hit / Math.min(ta.size, tb.size)
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
 * Resolve a JumpReference to the best locator target using the review-time
 * document map. Lookup order: explicit heading/excerpt → exact heading match →
 * bidirectional substring → token-overlap fuzzy → excerpt fallback. Returns
 * null only when the reference has no usable text.
 */
export function resolveReference(ref: JumpReference): ResolvedTarget | null {
  const headings = ref.docMap?.headings ?? []

  // Explicit fields win — callers that know more get exactly what they asked for.
  if (ref.heading?.trim()) {
    const norm = normalizeRef(ref.heading)
    const hit = headings.find((h) => normalizeRef(h.text) === norm)
    return hit ? toTarget(hit) : { kind: 'heading', headingText: ref.heading.trim(), path: [] }
  }
  if (ref.excerpt?.trim()) return { kind: 'excerpt', excerpt: ref.excerpt.trim() }

  const where = ref.where?.trim()
  if (!where) return null

  const cleaned = stripSectionPrefix(where)
  const normWhere = normalizeRef(cleaned)

  if (normWhere && headings.length) {
    // 1. Exact normalized match.
    const exact = headings.find((h) => normalizeRef(h.text) === normWhere)
    if (exact) return toTarget(exact)

    // 2. Bidirectional substring (either contains the other); prefer the longest
    //    heading text = most specific section.
    const sub = headings
      .filter((h) => {
        const ht = normalizeRef(h.text)
        return ht.length >= 4 && (ht.includes(normWhere) || normWhere.includes(ht))
      })
      .sort((a, b) => b.text.length - a.text.length)[0]
    if (sub) return toTarget(sub)

    // 3. Token-overlap fuzzy match (resilient to minor edits/rewording).
    let best: DocHeading | undefined
    let bestScore = 0
    for (const h of headings) {
      const score = overlap(cleaned, h.text)
      if (score > bestScore) {
        bestScore = score
        best = h
      }
    }
    if (best && bestScore >= 0.5 && !looksLikeQuote(where)) return toTarget(best)
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
