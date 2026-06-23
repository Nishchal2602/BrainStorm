import type { DocumentAnalysis } from '../../types'

const MAX_QUERIES = 12

/**
 * Build Reddit search queries from the shared DocumentAnalysis. Pure +
 * deterministic, precision-first: the analyzer's problem-specific searchQueries
 * lead, followed by the core problem and persona/category-qualified core-problem
 * variants. We deliberately do NOT emit generic "<word> frustrating" style
 * variants — those pulled off-topic posts. Deduped, blanks dropped, capped.
 */
export function buildQueries(analysis: DocumentAnalysis | undefined): string[] {
  if (!analysis) return []
  const { searchQueries = [], synonyms = [], coreProblem, persona, productCategory } = analysis

  const core = (coreProblem ?? '').trim()
  const variants: string[] = [
    ...searchQueries,
    core,
    persona && core ? `${persona} ${core}` : '',
    productCategory && core ? `${productCategory} ${core}` : '',
    // A couple of synonym phrasings, but only the problem-specific ones.
    ...synonyms.slice(0, 3),
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
