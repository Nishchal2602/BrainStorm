import type { DocumentAnalysis } from '../../types'

const MAX_QUERIES = 18

/**
 * Build Reddit search queries from the shared DocumentAnalysis. Pure +
 * deterministic. The analysis's searchQueries/synonyms lead (highest signal);
 * we then add persona- and category-qualified variants to widen recall. Deduped
 * (case-insensitive), blanks dropped, capped at MAX_QUERIES (10–18 typical).
 */
export function buildQueries(analysis: DocumentAnalysis | undefined): string[] {
  if (!analysis) return []
  const { searchQueries = [], synonyms = [], coreProblem, persona, productCategory } = analysis

  const core = (coreProblem ?? '').trim()
  const variants: string[] = [
    ...searchQueries,
    ...synonyms,
    core,
    // Persona- and category-qualified phrasings users actually post.
    persona && core ? `${persona} ${core}` : '',
    persona ? `${persona} frustration` : '',
    productCategory && core ? `${productCategory} ${core}` : '',
    ...synonyms.slice(0, 4).map((s) => `${s} frustrating`),
  ]

  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of variants) {
    const q = raw.trim().replace(/\s+/g, ' ')
    if (q.length < 3) continue
    const key = q.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(q)
    if (out.length >= MAX_QUERIES) break
  }
  return out
}
