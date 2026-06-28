import type { DocumentAnalysis } from '../../types'
import type { Hypothesis } from './hypothesis'

/**
 * Pure query builder. Turns a hypothesis's raw material (customer language +
 * search intent) into concrete Reddit/web searches — supporting, contradicting,
 * synonym, and long-tail. Kept pure (no LLM, no I/O) so retrieval can be tuned
 * without touching any model schema. We search reddit.com directly, so queries
 * are clean phrases (no "reddit" suffix, which would just filter on that word).
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

/** Per-hypothesis searches, prioritized (best signal first). */
export function buildQueries(h: Hypothesis, analysis?: DocumentAnalysis): string[] {
  const phrases = h.customerLanguage.map(clean).filter((p) => p.length >= 3)
  const topic = keyTerms(`${h.statement} ${h.searchIntent}`, 3).join(' ')

  const supporting = phrases
  // Quoted exact-phrase variants for the two strongest multi-word phrases.
  const quoted = phrases.filter((p) => p.includes(' ')).slice(0, 2).map((p) => `"${p}"`)
  // Satisfaction templates → surface people who do NOT have the problem (so the
  // verifier can find contradicting evidence and Mixed verdicts can occur).
  const contradicting = topic
    ? [`${topic} works well`, `happy with ${topic}`, `no problem with ${topic}`]
    : []
  const synonym = (analysis?.synonyms ?? []).map(clean).filter(Boolean)
  const longTail = h.searchIntent ? [keyTerms(h.searchIntent, 8).join(' ')].filter(Boolean) : []

  // Interleave categories so a single category can't dominate after capping.
  return interleave([supporting, quoted, contradicting, synonym, longTail])
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

/** Union of all hypotheses' queries, interleaved across hypotheses, deduped + capped. */
export function buildAllQueries(
  hypotheses: Hypothesis[],
  analysis: DocumentAnalysis | undefined,
  cap: number,
): string[] {
  const perHyp = hypotheses.map((h) => buildQueries(h, analysis))
  const ordered = interleave(perHyp)
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
