import type { DocumentAnalysis } from '../../types'

/**
 * Pure query builder. Retrieval now runs BEFORE the (single) validation call, so
 * queries derive from the shared DocumentAnalysis — its customer-vernacular
 * `searchQueries` + `synonyms` + problem terms — instead of per-hypothesis
 * customer language. Kept pure (no LLM, no I/O). We search reddit.com directly,
 * so queries are clean phrases (no "reddit" suffix).
 */

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'is', 'are', 'be', 'it', 'that',
  'this', 'with', 'as', 'ai', 'because', 'due', 'they', 'their', 'them', 'our', 'we', 'i',
  'users', 'user', 'use', 'using', 'tools', 'tool', 'when', 'how', 'why', 'what', 'do', 'does',
  'repeatedly', 'often', 'always', 'every', 'time', 'into', 'about', 'from', 'have', 'has',
])

const clean = (s: string): string => s.trim().replace(/\s+/g, ' ')

/** Significant words from a statement, in order, for building a short topic phrase. */
function keyTerms(s: string, n: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of s.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length < 3 || STOP.has(w) || seen.has(w)) continue
    seen.add(w)
    out.push(w)
    if (out.length >= n) break
  }
  return out
}

/** Round-robin merge so each list contributes before any list repeats. */
function interleave(lists: string[][]): string[] {
  const out: string[] = []
  const max = Math.max(0, ...lists.map((l) => l.length))
  for (let i = 0; i < max; i++) {
    for (const l of lists) if (i < l.length) out.push(l[i])
  }
  return out
}

/** Supporting / quoted / contradicting / synonym / long-tail searches from the
 * analysis alone, interleaved so no category dominates, deduped + capped. */
export function buildAllQueries(analysis: DocumentAnalysis | undefined, cap: number): string[] {
  const searchQueries = (analysis?.searchQueries ?? []).map(clean).filter((p) => p.length >= 3)
  const synonyms = (analysis?.synonyms ?? []).map(clean).filter((p) => p.length >= 3)
  const topic = keyTerms(`${analysis?.coreProblem ?? ''} ${analysis?.solutionCategory ?? ''}`, 3).join(' ')

  const supporting = searchQueries
  // Quoted exact-phrase variants for the two strongest multi-word queries.
  const quoted = searchQueries.filter((p) => p.includes(' ')).slice(0, 2).map((p) => `"${p}"`)
  // Satisfaction templates → surface people who do NOT have the problem (so the
  // validator can find contradicting evidence and Mixed verdicts can occur).
  const contradicting = topic
    ? [`${topic} works well`, `happy with ${topic}`, `no problem with ${topic}`]
    : []
  const longTail = analysis?.coreProblem
    ? [keyTerms(analysis.coreProblem, 8).join(' ')].filter((q) => q.length >= 3)
    : []

  const ordered = interleave([supporting, quoted, contradicting, synonyms, longTail])
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of ordered) {
    const q = clean(raw)
    if (q.length < 3) continue
    const k = q.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(q)
    if (out.length >= cap) break
  }
  return out
}
